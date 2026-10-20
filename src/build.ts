import crypto from 'node:crypto';
import { config } from './config.js';
import { isHttpUrl } from './contract.js';
import { findResult, saveResult, updateResult } from './db.js';
import { getLogo } from './logo.js';
import { parseManifestTable, resolveInputs } from './manifest.js';
import { writeContent } from './custom/content.js';
import { cta, palette, renderPage } from './custom/render.js';
import { runCustomChecks } from './custom/checks.js';
import { callExternal, compileRequest } from './external/run.js';
import { findMagnetOwner, findPlayContext } from './gtma.js';
import { isRelatedManifest, splitManifest } from './related/finders.js';
import { relatedForProspect } from './related/resolve.js';
import type { BuildResponse, Colors, CtaInfo, Endpoint, Fixture, FixtureResult, LogoResult, ManifestEntry, Payload } from './types.js';

const inflight = new Map<string, Promise<FixtureResult>>();

interface BuildContext {
  payload: Payload;
  endpoint: Endpoint;
  base: string;
  manifest: ManifestEntry[] | null;
  // related-companies magnet (rulings 63-64): the finder keys and per-company keys stay out of the
  // prospect-level input check; the found companies carry their own values.
  related: boolean;
  prospectManifest: ManifestEntry[] | null;
  perCompany: ManifestEntry[];
  clientId: string | null;
  colors: Colors;
  ctaInfo: CtaInfo | null;
  turnaroundMs: number;
  shared: { authFailed: boolean };
}

interface FixtureContext extends BuildContext {
  t0: number;
}

// Same idempotency_key -> the stored result (transport retries never rebuild or re-POST).
// A new key -> a fresh build (a change request, or a deliberate retry after GTMA's QA failed).
function dedupeKey(endpoint: Endpoint, payload: Payload, fixture: Fixture): string {
  return [endpoint, payload.lead_magnet_id, fixture.person_id, fixture.reply_id ?? '-', payload.idempotency_key].join(':');
}

function hostedBase(magnet: Payload['magnet']): string {
  return isHttpUrl(magnet.hosted_base_url) ? magnet.hosted_base_url.replace(/\/+$/, '') : config.publicBaseUrl;
}

async function pageResolves(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const ok = res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/html');
    await res.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

function baseResult(fixture: Fixture): FixtureResult {
  return {
    person_id: fixture.person_id,
    lead_list_id: fixture.lead_list_id ?? null,
    status: 'failed',
    url: null,
    latency_ms: 0,
    checks: {},
    failure_reason: null,
    notes: [],
  };
}

async function buildCustom(ctx: FixtureContext, inFixture: Fixture, key: string): Promise<FixtureResult> {
  const { payload, endpoint, manifest, colors, ctaInfo, turnaroundMs, t0 } = ctx;
  const r = baseResult(inFixture);
  const done = (patch: Partial<FixtureResult>): FixtureResult => ({ ...r, ...patch, latency_ms: Date.now() - t0 });
  if (!manifest) r.notes.push('no input manifest in recipe; required inputs not enforced by the service');

  const resolved = resolveInputs(ctx.prospectManifest, inFixture, payload.recipe.play_constants);
  if (resolved.missingRequired.length) return done({ failure_reason: `missing input ${resolved.missingRequired.join(', ')}` });
  if (!ctaInfo) return done({ failure_reason: 'no booking_url and no client website: no CTA target (never invented)' });

  const company = inFixture.company as Record<string, unknown>;
  const logoJob = getLogo(company?.primary_domain).catch((e: Error): LogoResult => ({ ok: false, reason: `logo error: ${e.message}` }));

  // Related-companies magnet: find the companies first unless GTMA already sent them.
  let fixture = inFixture;
  if (ctx.related && !inFixture.related_companies?.length) {
    const domain = String(company?.primary_domain ?? '').toLowerCase().replace(/^www\./, '');
    if (!domain) return done({ failure_reason: 'related-companies magnet needs the prospect company domain to find its customers' });
    try {
      const out = await relatedForProspect({
        prospect: { name: String(company?.company_name ?? domain), domain, about: (company?.about as string | null) ?? null },
        perCompany: ctx.perCompany,
        clientId: ctx.clientId,
        play: payload.play ?? null,
      });
      r.notes.push(...out.trace);
      r.related = { basis: out.basis, companies: out.related.map((c) => ({ name: c.name, found_by: c.found_by, like: c.like ?? null })) };
      if (!out.related.length) return done({ failure_reason: 'no related company could be found (case studies, lookalikes and target market all came up empty)' });
      fixture = { ...inFixture, related_companies: out.related };
    } catch (e) {
      return done({ failure_reason: `finding related companies failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else if (fixture.related_companies?.length) {
    r.related = { basis: 'given', companies: fixture.related_companies.map((c) => ({ name: c.name, found_by: c.found_by, like: c.like ?? null })) };
  }

  let logo: LogoResult;
  let content;
  try {
    [logo, content] = await Promise.all([logoJob, writeContent({ payload, fixture, resolved })]);
  } catch (e) {
    return done({ failure_reason: `content generation failed: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (content.missing_required_inputs.length) {
    return done({ failure_reason: `missing input ${content.missing_required_inputs.join(', ')} (reported by recipe execution)` });
  }

  const token = crypto.randomBytes(16).toString('base64url');
  const url = `${ctx.base}/${token}`;
  const { html, carousel } = renderPage({ content, payload, fixture, logo, colors, ctaInfo });
  const { checks, notes } = runCustomChecks({ html, content, payload, fixture, resolved, logo, colors, ctaInfo, carousel, related: ctx.related });
  r.notes.push(...notes);

  await saveResult({
    dedupeKey: key, endpoint, kind: 'custom', leadMagnetId: payload.lead_magnet_id, runtimeId: payload.runtime_id ?? null,
    runtimeVersion: payload.runtime_version ?? null, gtmPlayId: payload.gtm_play_id ?? null, personId: fixture.person_id,
    replyId: fixture.reply_id ?? null, token, url, html, status: 'produced', result: done({ status: 'produced', url, checks }),
  });

  checks.url_resolves = await pageResolves(url);
  const latency = Date.now() - t0;
  checks.within_turnaround = latency <= turnaroundMs;
  const result = checks.url_resolves
    ? done({ status: 'produced', url, checks })
    : done({ status: 'failed', url, checks, failure_reason: 'hosted page does not resolve at its URL' });
  await updateResult(key, result.status, result);
  return result;
}

async function buildExternal(ctx: FixtureContext, fixture: Fixture, key: string): Promise<FixtureResult> {
  const { payload, endpoint, manifest, turnaroundMs, t0 } = ctx;
  const r = baseResult(fixture);
  const done = (patch: Partial<FixtureResult>): FixtureResult => ({
    ...r,
    ...patch,
    notes: [...r.notes, ...(patch.notes ?? [])],
    latency_ms: Date.now() - t0,
  });
  if (ctx.shared.authFailed) return done({ failure_reason: 'skipped: client API rejected the credential on an earlier fixture' });
  if (!manifest) r.notes.push('no input manifest in recipe; required inputs not enforced by the service');

  const resolved = resolveInputs(manifest, fixture, payload.recipe.play_constants);
  if (resolved.missingRequired.length) return done({ failure_reason: `missing input ${resolved.missingRequired.join(', ')}` });

  const mode = endpoint === 'build-previews' ? 'preview' : 'production';
  let spec;
  try {
    spec = await compileRequest({ payload, fixture, resolved, mode });
  } catch (e) {
    return done({ failure_reason: `request compile failed: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (spec.missing_required_inputs.length) {
    return done({ failure_reason: `missing input ${spec.missing_required_inputs.join(', ')} (reported by recipe execution)` });
  }

  const out = await callExternal({ payload, spec, mode });
  if (out.authFailed) ctx.shared.authFailed = true;
  const checks = { ...out.checks };
  if (out.status === 'produced') checks.within_turnaround = Date.now() - t0 <= turnaroundMs;
  const result = done({
    status: out.status, url: out.url, checks, failure_reason: out.failure_reason, notes: out.notes,
    artifact_may_exist: out.artifactMayExist,
  });

  // Anything past a 2xx may have created a real artifact: record it so a retry with the same key never re-POSTs.
  if (out.artifactMayExist) {
    await saveResult({
      dedupeKey: key, endpoint, kind: 'external', leadMagnetId: payload.lead_magnet_id, runtimeId: payload.runtime_id ?? null,
      runtimeVersion: payload.runtime_version ?? null, gtmPlayId: payload.gtm_play_id ?? null, personId: fixture.person_id,
      replyId: fixture.reply_id ?? null, token: null, url: out.url, html: null, status: result.status, result,
    });
  }
  return result;
}

async function buildOne(ctx: BuildContext, fixture: Fixture): Promise<FixtureResult> {
  const key = dedupeKey(ctx.endpoint, ctx.payload, fixture);
  const cached = await findResult(key);
  // Custom: only a produced page is reused (a failed one is rebuilt). External: any stored call is reused.
  if (cached && (cached.status === 'produced' || cached.kind === 'external')) return { ...cached.result, cached: true };
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<FixtureResult> => {
    const t0 = Date.now();
    try {
      const fixtureCtx: FixtureContext = { ...ctx, t0 };
      return ctx.payload.magnet.kind === 'custom' ? await buildCustom(fixtureCtx, fixture, key) : await buildExternal(fixtureCtx, fixture, key);
    } catch (e) {
      return { ...baseResult(fixture), latency_ms: Date.now() - t0, failure_reason: `internal error: ${e instanceof Error ? e.message : String(e)}` };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function runBuild(inPayload: Payload, endpoint: Endpoint): Promise<BuildResponse> {
  const manifest = inPayload.recipe.input_manifest ?? parseManifestTable(inPayload.recipe.skill_md);
  const related = inPayload.magnet.kind === 'custom' && isRelatedManifest(manifest);
  const split = splitManifest(manifest ?? [], related);

  // The play's angle feeds "What <prospect> could do with this" and the target-market finder.
  let payload = inPayload;
  if (!payload.play && payload.gtm_play_id) {
    const play = await findPlayContext(payload.gtm_play_id).catch(() => null);
    if (play) payload = { ...payload, play: { ...play } as Payload['play'] };
  }
  let clientId = payload.client.client_id ?? null;
  if (related && !clientId) clientId = (await findMagnetOwner(payload.lead_magnet_id).catch(() => null))?.client_id ?? null;

  const ctx: BuildContext = {
    payload,
    endpoint,
    base: hostedBase(payload.magnet),
    manifest,
    related,
    prospectManifest: manifest ? split.prospect : null,
    perCompany: split.perCompany,
    clientId,
    colors: palette(payload.client.brand_colors),
    ctaInfo: cta(payload.client),
    turnaroundMs: payload.recipe.output_contract.expected_turnaround_minutes * 60_000,
    // shared across fixtures so one 401/403 stops the rest of an external set
    shared: { authFailed: false },
  };

  let results: FixtureResult[];
  if (payload.magnet.kind === 'custom') {
    results = await Promise.all(payload.fixtures.map((f) => buildOne(ctx, f)));
  } else {
    // one at a time: each POST can create a real artifact, and an auth failure must stop the set
    results = [];
    for (const f of payload.fixtures) results.push(await buildOne(ctx, f));
  }
  return { lead_magnet_id: payload.lead_magnet_id, runtime_id: payload.runtime_id ?? null, runtime_version: payload.runtime_version ?? null, results };
}
