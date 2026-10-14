// Reply-time production (rulings 32, 46, 48-52). The autoresponder sends only a lead reference;
// everything else is read from GTMA's database. Returns a link only when the deliverable passed
// the pre-send checks AND the frozen QA prompt; every run is logged in magnet_productions.
import crypto from 'node:crypto';
import type { z } from 'zod';
import { BuildPayload, type ReplyRequest } from '../contract.js';
import { runBuild } from '../build.js';
import { pageByToken } from '../db.js';
import { visibleText } from '../text.js';
import * as g from '../gtma.js';
import { resolveManifest, type InputResolution } from './inputs.js';
import { runQa, type QaVerdict } from './qa.js';
import { resolveCredential } from './vendors.js';
import type { Payload } from '../types.js';

export type ReplyRequestBody = z.infer<typeof ReplyRequest>;

export type ReplyStatus = 'produced' | 'failed' | 'no_magnet' | 'standard_asset' | 'held' | 'not_found' | 'ambiguous';

export interface ReplyResponse {
  status: ReplyStatus;
  link: string | null;
  qa_notes: string | null;
  production_id: string | null;
  lead_magnet_id: string | null;
  omitted_inputs: string[];
  failure_reason: string | null;
  attempts?: number;
  cached?: boolean;
}

const inflight = new Map<string, Promise<ReplyResponse>>();

function outcome(status: ReplyStatus, extra: Partial<ReplyResponse> = {}): ReplyResponse {
  return { status, link: null, qa_notes: null, production_id: null, lead_magnet_id: null, omitted_inputs: [], failure_reason: null, ...extra };
}

async function deliverableText(kind: 'custom' | 'external', url: string): Promise<string> {
  if (kind === 'custom') {
    const html = await pageByToken(url.split('/').pop() ?? '');
    return html ? visibleText(html) : '';
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return visibleText(await res.text());
  } catch {
    return '';
  }
}

export function produceForReply(req: ReplyRequestBody): Promise<ReplyResponse> {
  const lockKey = `${req.sequencer_campaign_id}:${req.sequencer_lead_id}`;
  const existing = inflight.get(lockKey);
  if (existing) return existing;
  const job = run(req).finally(() => inflight.delete(lockKey));
  inflight.set(lockKey, job);
  return job;
}

async function run(req: ReplyRequestBody): Promise<ReplyResponse> {
  // B2: the lookup chain. (campaign id, lead id) is unique by design; the sequencer disambiguates if not.
  let leads = await g.findLeads(req.sequencer_campaign_id, req.sequencer_lead_id);
  if (leads.length > 1) leads = leads.filter((l) => (l.sequencer ?? '').toLowerCase() === req.sequencer.toLowerCase());
  if (leads.length === 0) return outcome('not_found', { failure_reason: 'no play lead list row for this sequencer campaign + lead id' });
  if (leads.length > 1) return outcome('ambiguous', { failure_reason: 'more than one play lead list row matches this reference' });
  const lead = leads[0]!;

  if (!lead.lead_magnet_id) return outcome('no_magnet');
  const magnet = await g.findMagnet(lead.lead_magnet_id);
  if (!magnet) return outcome('held', { failure_reason: 'the play points at a lead magnet that does not exist' });
  const base = { lead_magnet_id: magnet.lead_magnet_id };
  if (magnet.fulfillment_mode === 'standard_asset') return outcome('standard_asset', base);
  const runtime =
    magnet.status === 'approved' && magnet.current_runtime_version
      ? await g.findApprovedRuntime(magnet.lead_magnet_id, magnet.current_runtime_version)
      : null;
  if (!runtime) {
    return outcome('held', { ...base, failure_reason: 'launch gate bypass: the play is live with no approved runtime for its magnet' });
  }

  // One production per (magnet, person, reply): a repeat call for the same reply returns the same link.
  // A caller-supplied reply_id must be a real row (it's a DB foreign key) or the one write this
  // service makes would crash; fall back to our own lookup rather than trust the caller blindly.
  let replyId = req.reply_id && (await g.replyExists(req.reply_id)) ? req.reply_id : null;
  let badReplyId: string | null = null;
  if (req.reply_id && !replyId) badReplyId = req.reply_id;
  replyId ??= await g.findInterestedReply(lead.person_id, lead.gtm_play_id);
  if (replyId) {
    const done = await g.findProducedForReply(magnet.lead_magnet_id, lead.person_id, replyId);
    if (done) {
      const out = done.output as { url?: string; qa?: { notes?: string }; omitted_inputs?: string[] };
      return outcome('produced', {
        ...base, link: out.url ?? null, qa_notes: out.qa?.notes ?? null, production_id: done.production_id,
        omitted_inputs: out.omitted_inputs ?? [], cached: true,
      });
    }
  }

  const log = (status: 'produced' | 'failed', inputs: InputResolution | null, output: Record<string, unknown>, failure: string | null) =>
    g.logProduction({
      lead_magnet_id: magnet.lead_magnet_id, lead_magnet_name: magnet.lead_magnet_name, magnet_version: runtime.version,
      client_id: lead.client_id, client_name: lead.client_name, sub_profile_id: lead.sub_profile_id,
      sub_profile_name: lead.sub_profile_name, gtm_play_id: lead.gtm_play_id, gtm_play_name: lead.gtm_play_name,
      person_id: lead.person_id, company_id: lead.company_id, reply_id: replyId,
      trigger: replyId ? 'positive_reply' : 'manual', status,
      inputs_used: inputs ? { values: inputs.values, sources: inputs.sources, unavailable: inputs.unavailable } : {},
      output: {
        ...output,
        ...(replyId ? {} : { note: 'no interested reply row found for this lead; logged as manual' }),
        ...(badReplyId ? { note: `caller-supplied reply_id ${badReplyId} does not exist in replies; ignored` } : {}),
      },
      failure_reason: failure,
    });
  const failed = async (reason: string, inputs: InputResolution | null, output: Record<string, unknown> = {}, attempts?: number) => {
    const production_id = await log('failed', inputs, output, reason);
    return outcome('failed', {
      ...base, production_id, failure_reason: reason, attempts,
      omitted_inputs: inputs?.unavailable.map((u) => u.key) ?? [],
    });
  };

  // B3: the input waterfall.
  const [company, person] = await Promise.all([
    lead.company_id ? g.findCompanyFacts(lead.company_id, lead.sub_profile_id) : null,
    g.findPersonFacts(lead.person_id, lead.sub_profile_id),
  ]);
  const inputs = await resolveManifest(runtime.input_manifest, { lead, company, person, playConstants: runtime.play_constants ?? {} });
  if (inputs.missingRequired.length) {
    return failed(`missing input ${inputs.missingRequired.join(', ')} (lead_list keys must be on the lead before go-live: gate bypass)`, inputs);
  }

  // B4: assemble the same payload shape GTMA sends for previews, and build with the shared builder.
  let integration: Payload['magnet']['integration'] = null;
  if (magnet.magnet_kind === 'external') {
    const integ = magnet.integration_id ? await g.findIntegration(magnet.integration_id) : null;
    const credential = resolveCredential(integ?.credential_ref);
    if (!integ) return failed('external magnet has no active client integration', inputs);
    if (!credential) return failed(`credential ${integ.credential_ref ?? '(none)'} is not configured on the generator`, inputs);
    integration = { base_url: integ.base_url, auth_kind: integ.auth_kind, credential, endpoint_path: magnet.endpoint_path, test_mode: (integ.test_mode as never) ?? null };
  }

  const unavailable = inputs.unavailable.map((u) => u.key);
  let payload: Payload;
  try {
    payload = BuildPayload.parse({
      lead_magnet_id: magnet.lead_magnet_id,
      runtime_id: runtime.runtime_id,
      runtime_version: runtime.version,
      gtm_play_id: lead.gtm_play_id,
      idempotency_key: 'pending',
      recipe: {
        skill_md: runtime.skill_md,
        play_constants: runtime.play_constants ?? {},
        input_manifest: runtime.input_manifest.map((m) => ({
          key: m.key, source: m.source, required: m.source === 'lead_list' && m.required !== false, fallback: m.fallback ?? null,
        })),
        output_contract: runtime.output_contract ?? {},
        failure_policy: runtime.failure_policy ?? undefined,
      },
      magnet: {
        kind: magnet.magnet_kind, name: magnet.lead_magnet_name, promise: magnet.promise ?? [], description: magnet.description ?? '',
        hosting: magnet.hosting, hosted_base_url: magnet.hosted_base_url, integration,
      },
      client: {
        client_name: lead.client_name, website: lead.product_website, brand_colors: lead.brand_colors ?? {},
        logo_url: lead.logo_url, booking_url: lead.booking_url, booking_poc_name: lead.booking_poc_name,
      },
      proofpoints: await g.findProofpoints(lead.sub_profile_id),
      fixtures: [{
        person_id: lead.person_id, lead_list_id: lead.lead_list_id, reply_id: replyId,
        first_name: (person?.first_name as string | null) ?? (person?.full_name as string | null)?.split(' ')[0] ?? null,
        full_name: (person?.full_name as string | null) ?? null,
        company: {
          company_name: company?.company_name, primary_domain: company?.primary_domain, industry: company?.industry,
          employee_count: company?.employees_on_linkedin, hq_city: company?.hq_city, hq_country: company?.hq_country, about: company?.about,
        },
        inputs: inputs.values,
        unavailable_inputs: unavailable,
      }],
    });
  } catch (e) {
    return failed(`magnet or runtime configuration is invalid: ${e instanceof Error ? e.message : String(e)}`, inputs);
  }

  // B5: build, pre-send checks, frozen QA. Ruling 46: retry per failure_policy; never return a link that failed.
  const retries = payload.recipe.failure_policy?.retries ?? 2;
  const preSend = payload.recipe.output_contract.pre_send_checks;
  const runKey = req.idempotency_key ?? crypto.randomUUID();
  let lastFailure = 'production failed';
  let attempts = 0;
  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt <= retries; attempt++) {
    const built = await runBuild({ ...payload, idempotency_key: `${runKey}:a${attempt}` }, 'produce');
    const r = built.results[0]!;
    attempts = attempt + 1;
    last = { url: r.url, checks: r.checks, notes: r.notes, latency_ms: r.latency_ms, omitted_inputs: unavailable, attempts };
    // External: once the client tool answered 2xx a real artifact may exist there, so never re-POST blindly.
    const mayRetry = !(magnet.magnet_kind === 'external' && r.artifact_may_exist);
    if (r.status !== 'produced' || !r.url) {
      lastFailure = r.failure_reason ?? 'build failed';
      if (mayRetry) continue;
      break;
    }
    const failedChecks = preSend.filter((c) => r.checks[c] === false);
    if (failedChecks.length) {
      lastFailure = `pre-send checks failed: ${failedChecks.join(', ')}`;
      if (mayRetry) continue;
      break;
    }

    let qa: QaVerdict;
    try {
      qa = await runQa({
        qaPrompt: runtime.qa_prompt,
        promise: payload.magnet.promise,
        prospect: { full_name: payload.fixtures[0]!.full_name ?? null, company_name: (company?.company_name as string | null) ?? null },
        obtained: Object.keys(inputs.values),
        omitted: inputs.unavailable,
        checks: r.checks,
        pageText: await deliverableText(magnet.magnet_kind, r.url),
      });
    } catch (e) {
      lastFailure = `qa could not run: ${e instanceof Error ? e.message : String(e)}`;
      if (mayRetry) continue;
      break;
    }
    last = { ...last, qa };
    if (!qa.pass) {
      lastFailure = `qa_failed: ${qa.notes}`;
      if (mayRetry) continue;
      break;
    }

    const production_id = await log('produced', inputs, last, null);
    return outcome('produced', {
      ...base, link: r.url, qa_notes: qa.notes, production_id, omitted_inputs: unavailable, attempts: attempt + 1,
    });
  }
  // Flagged + parked: no link goes back, the reply waits (ruling 46).
  return failed(lastFailure, inputs, last, attempts);
}
