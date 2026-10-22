import { config } from './config.js';
import { isHttpUrl } from './contract.js';
import { findResult, saveResult, updateResult } from './db.js';
import { getLogo } from './logo.js';
import { colorsFrom, DEFAULT_COLORS, prospectPalette } from './brand.js';
import { isPresent, lookup, parseManifestTable, resolveInputs } from './manifest.js';
import { writeContent } from './custom/content.js';
import { cta, pageToken, renderPage } from './custom/render.js';
import { runCustomChecks } from './custom/checks.js';
import { callExternal, externalSpec, requestValues, type ExternalSpec } from './external/run.js';
import { findMagnetOwner, findPlayContext, findResources } from './gtma.js';
import { resolveManifest } from './reply/inputs.js';
import { isRelatedManifest, splitManifest } from './related/finders.js';
import { relatedForProspect } from './related/resolve.js';
import type { BuildResponse, Colors, CtaInfo, Endpoint, Fixture, FixtureResult, LogoResult, ManifestEntry, Payload, ResolvedInputs } from './types.js';

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
  ctaInfo: CtaInfo | null;
  external: ExternalSpec | { error: string } | null;
  turnaroundMs: number;
  // shared across an external set: the first call is the test call (ruling 79)
  shared: { stopReason: string | null; firstCallDone: boolean };
}

interface FixtureContext extends BuildContext {
  t0: number;
}

const fixtureId = (f: Fixture): string => String(f.person_id ?? f.company_id);

// Same idempotency_key -> the stored result (transport retries never rebuild or re-call).
// A new key -> a fresh build (a change request, or a deliberate retry).
function dedupeKey(endpoint: Endpoint, payload: Payload, fixture: Fixture): string {
  return [endpoint, payload.lead_magnet_id, fixtureId(fixture), fixture.reply_id ?? '-', payload.idempotency_key].join(':');
}

// Ours = the shared neutral domain (PUBLIC_BASE_URL); client_domain = the verified subdomain.
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
    person_id: fixture.person_id ?? null,
    company_id: fixture.company_id ?? null,
    lead_list_id: fixture.lead_list_id ?? null,
    status: 'failed',
    url: null,
    latency_ms: 0,
    checks: {},
    failure_reason: null,
    notes: [],
  };
}

const isOnList = (e: ManifestEntry): boolean => e.source !== 'generation_time' && e.source !== 'play_constant';

// Ruling 94: previews fetch generation_time values themselves, the same way as at reply time
// (shared cache first, then the data key's paid tool). At reply time they are already resolved.
// Only a missing ON-LIST input is a hard fail; anything else is omitted and noted (ruling 50).
async function gatherInputs(ctx: BuildContext, fixture: Fixture, manifest: ManifestEntry[]): Promise<{ fixture: Fixture; resolved: ResolvedInputs; notes: string[] }> {
  const pc = ctx.payload.recipe.play_constants;
  const inputs = { ...(fixture.inputs as Record<string, unknown>) };
  const unavailable = new Set(fixture.unavailable_inputs);
  const notes: string[] = [];

  const toFetch = ctx.endpoint === 'build-previews' ? manifest.filter((e) => e.source === 'generation_time' && !isPresent(lookup(e.key, fixture, pc))) : [];
  if (toFetch.length) {
    const company = (fixture.company ?? {}) as Record<string, unknown>;
    try {
      const res = await resolveManifest(
        toFetch.map((e) => ({ key: e.key, source: 'generation_time', required: false })),
        {
          lead: { enrichments_used: inputs, email: null, company_id: fixture.company_id ?? null, person_id: fixture.person_id ?? null },
          company: {
            ...company,
            employees_on_linkedin: company.employees_on_linkedin ?? company.employee_count,
            linkedin_url: company.linkedin_url ?? inputs.company_linkedin_url,
            website: company.website ?? inputs.company_website,
          },
          person: { full_name: fixture.full_name, first_name: fixture.first_name },
          playConstants: pc,
        },
      );
      Object.assign(inputs, res.values);
      for (const [k, src] of Object.entries(res.sources)) notes.push(`${k} from ${src}`);
      for (const u of res.unavailable) {
        unavailable.add(u.key);
        notes.push(`${u.key} not obtained (${u.reason}); its section is left out`);
      }
    } catch (e) {
      for (const x of toFetch) unavailable.add(x.key);
      notes.push(`could not fetch ${toFetch.map((x) => x.key).join(', ')} (${e instanceof Error ? e.message : String(e)}); their sections are left out`);
    }
  }

  const next: Fixture = { ...fixture, inputs, unavailable_inputs: [...unavailable] };
  const resolved = resolveInputs(manifest.map((e) => (isOnList(e) ? e : { ...e, required: false })), next, pc);
  next.unavailable_inputs = next.unavailable_inputs.filter((k) => !resolved.usedFallback.includes(k));
  return { fixture: next, resolved, notes };
}

async function saveWithToken(ctx: FixtureContext, key: string, fixture: Fixture, companyName: string, make: (token: string, url: string) => { html: string; result: FixtureResult }) {
  for (let attempt = 0; ; attempt++) {
    const token = pageToken(companyName);
    const url = `${ctx.base}/${token}`;
    const { html, result } = make(token, url);
    try {
      await saveResult({
        dedupeKey: key, endpoint: ctx.endpoint, kind: 'custom', leadMagnetId: ctx.payload.lead_magnet_id, runtimeId: ctx.payload.runtime_id ?? null,
        runtimeVersion: ctx.payload.runtime_version ?? null, gtmPlayId: ctx.payload.gtm_play_id ?? null, personId: fixtureId(fixture),
        replyId: fixture.reply_id ?? null, token, url, html, status: 'produced', result,
      });
      return { url, result };
    } catch (e) {
      // a random code that is already taken: draw a new one
      if ((e as { code?: string }).code === '23505' && attempt < 3) continue;
      throw e;
    }
  }
}

async function buildCustom(ctx: FixtureContext, inFixture: Fixture, key: string): Promise<FixtureResult> {
  const { payload, manifest, ctaInfo, turnaroundMs, t0 } = ctx;
  const r = baseResult(inFixture);
  const done = (patch: Partial<FixtureResult>): FixtureResult => ({ ...r, ...patch, latency_ms: Date.now() - t0 });
  if (!manifest) r.notes.push('no input manifest in recipe; required inputs not enforced by the service');

  const company = inFixture.company as Record<string, unknown>;
  const domain = company?.primary_domain;
  const logoJob = getLogo(domain).catch((e: Error): LogoResult => ({ ok: false, reason: `logo error: ${e.message}` }));
  // Ruling 89: the prospect's own colour (from its site and logo), ember orange when none passes.
  const colorJob = logoJob.then((logo) => prospectPalette(domain, logo)).then(colorsFrom, (): Colors => DEFAULT_COLORS);

  const gathered = await gatherInputs(ctx, inFixture, ctx.prospectManifest ?? []);
  let fixture = gathered.fixture;
  const resolved = gathered.resolved;
  r.notes.push(...gathered.notes);
  r.values_used = resolved.values;
  if (resolved.missingRequired.length) return done({ failure_reason: `missing input ${resolved.missingRequired.join(', ')}` });
  if (!ctaInfo) return done({ failure_reason: 'no booking_url and no client website: no CTA target (never invented)' });

  // Related-companies magnet: find the companies first unless GTMA already sent them.
  if (ctx.related && !fixture.related_companies?.length) {
    const d = String(domain ?? '').toLowerCase().replace(/^www\./, '');
    if (!d) return done({ failure_reason: 'related-companies magnet needs the prospect company domain to find its customers' });
    try {
      const out = await relatedForProspect({
        prospect: { name: String(company?.company_name ?? d), domain: d, about: (company?.about as string | null) ?? null },
        perCompany: ctx.perCompany,
        clientId: ctx.clientId,
        play: payload.play ?? null,
      });
      r.notes.push(...out.trace);
      r.related = { basis: out.basis, companies: out.related.map((c) => ({ name: c.name, found_by: c.found_by, like: c.like ?? null })) };
      if (!out.related.length) return done({ failure_reason: 'no related company could be found (case studies, lookalikes and target market all came up empty)' });
      fixture = { ...fixture, related_companies: out.related };
    } catch (e) {
      return done({ failure_reason: `finding related companies failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else if (fixture.related_companies?.length) {
    r.related = { basis: 'given', companies: fixture.related_companies.map((c) => ({ name: c.name, found_by: c.found_by, like: c.like ?? null })) };
  }

  let logo: LogoResult;
  let colors: Colors;
  let content;
  try {
    [logo, colors, content] = await Promise.all([logoJob, colorJob, writeContent({ payload, fixture, resolved })]);
  } catch (e) {
    return done({ failure_reason: `content generation failed: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (content.missing_required_inputs.length) {
    return done({ failure_reason: `missing input ${content.missing_required_inputs.join(', ')} (reported by recipe execution)` });
  }
  r.notes.push(colors.fromProspect ? `colour ${colors.accent} from the prospect's ${colors.source.replace(/_/g, ' ')}` : 'no prospect colour passed the check: ember orange used');

  const { html, carousel } = renderPage({ content, payload, fixture, logo, colors, ctaInfo });
  const { checks, notes } = runCustomChecks({ html, content, payload, fixture, resolved, logo, colors, ctaInfo, carousel, related: ctx.related });
  r.notes.push(...notes);

  const companyName = String(company?.company_name ?? domain ?? '');
  const { url } = await saveWithToken(ctx, key, fixture, companyName, (_token, u) => ({ html, result: done({ status: 'produced', url: u, checks }) }));

  checks.url_resolves = await pageResolves(url);
  checks.within_turnaround = Date.now() - t0 <= turnaroundMs;
  const result = checks.url_resolves
    ? done({ status: 'produced', url, checks })
    : done({ status: 'failed', url, checks, failure_reason: 'hosted page does not resolve at its URL' });
  await updateResult(key, result.status, result);
  return result;
}

async function buildExternal(ctx: FixtureContext, inFixture: Fixture, key: string): Promise<FixtureResult> {
  const { payload, turnaroundMs, t0 } = ctx;
  const r = baseResult(inFixture);
  const done = (patch: Partial<FixtureResult>): FixtureResult => ({ ...r, ...patch, notes: [...r.notes, ...(patch.notes ?? [])], latency_ms: Date.now() - t0 });
  const spec = ctx.external;
  if (!spec || 'error' in spec) return done({ failure_reason: spec?.error ?? 'external magnets need magnet.integration' });
  if (ctx.shared.stopReason) return done({ failure_reason: `skipped: the test call failed (${ctx.shared.stopReason})` });

  const gathered = await gatherInputs(ctx, inFixture, ctx.manifest ?? []);
  const fixture = gathered.fixture;
  r.notes.push(...gathered.notes);
  if (gathered.resolved.missingRequired.length) return done({ failure_reason: `missing input ${gathered.resolved.missingRequired.join(', ')}` });

  const { body, missing } = requestValues(spec, fixture, gathered.resolved, payload.recipe.play_constants);
  r.values_used = body;
  if (missing.length) return done({ failure_reason: `input missing on the lead: ${missing.join(', ')}` });

  const testCall = !ctx.shared.firstCallDone;
  ctx.shared.firstCallDone = true;
  const company = fixture.company as Record<string, unknown>;
  const out = await callExternal({
    spec,
    body,
    company: { name: String(company?.company_name ?? ''), domain: (company?.primary_domain as string | null) ?? null },
    retries: payload.recipe.failure_policy?.retries ?? 2,
  });
  // A setup problem stops the set: a refused key at any point, or anything set-wide on the test call.
  if (out.authFailed || (testCall && out.setWide)) ctx.shared.stopReason = out.failure_reason;
  const checks = { ...out.checks };
  if (out.status === 'produced') checks.within_turnaround = Date.now() - t0 <= turnaroundMs;
  const result = done({
    status: out.status, url: out.url, checks, failure_reason: out.failure_reason, notes: out.notes,
    artifact_may_exist: out.artifactMayExist, test_call: testCall,
  });

  // Anything past a 2xx may have made a real item: record it so a retry with the same key never calls again.
  if (out.artifactMayExist) {
    await saveResult({
      dedupeKey: key, endpoint: ctx.endpoint, kind: 'external', leadMagnetId: payload.lead_magnet_id, runtimeId: payload.runtime_id ?? null,
      runtimeVersion: payload.runtime_version ?? null, gtmPlayId: payload.gtm_play_id ?? null, personId: fixtureId(fixture),
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
  const custom = inPayload.magnet.kind === 'custom';
  const related = custom && isRelatedManifest(manifest);
  const split = splitManifest(manifest ?? [], related);

  // The play's angle feeds "What <prospect> could do with this" and the target-market finder.
  let payload = inPayload;
  if (!payload.play && payload.gtm_play_id) {
    const play = await findPlayContext(payload.gtm_play_id).catch(() => null);
    if (play) payload = { ...payload, play: { ...play } as Payload['play'] };
  }

  let clientId = payload.client.client_id ?? null;
  let subProfileId: string | null = null;
  const needOwner = custom && (related || (!payload.proofpoints.length && !payload.resources.length));
  if (needOwner) {
    const owner = await findMagnetOwner(payload.lead_magnet_id).catch(() => null);
    clientId ??= owner?.client_id ?? null;
    subProfileId = owner?.sub_profile_id ?? null;
  }
  // Carousel fallback (ruling 57): no case studies and no resources sent -> the client's own assets.
  if (custom && !payload.proofpoints.length && !payload.resources.length && clientId) {
    const resources = (await findResources(clientId, subProfileId).catch(() => [])).filter((x) => isHttpUrl(x.url));
    if (resources.length) payload = { ...payload, resources: resources as Payload['resources'] };
  }

  const ctx: BuildContext = {
    payload,
    endpoint,
    base: hostedBase(payload.magnet),
    manifest,
    related,
    prospectManifest: manifest ? split.prospect : null,
    perCompany: split.perCompany,
    clientId,
    ctaInfo: cta(payload.client),
    external: custom ? null : externalSpec(payload),
    turnaroundMs: payload.recipe.output_contract.expected_turnaround_minutes * 60_000,
    shared: { stopReason: null, firstCallDone: false },
  };

  let results: FixtureResult[];
  if (custom) {
    results = await Promise.all(payload.fixtures.map((f) => buildOne(ctx, f)));
  } else {
    // one at a time: each call can create a real item, and a failed test call stops the set
    results = [];
    for (const f of payload.fixtures) results.push(await buildOne(ctx, f));
  }
  return { lead_magnet_id: payload.lead_magnet_id, runtime_id: payload.runtime_id ?? null, runtime_version: payload.runtime_version ?? null, results };
}
