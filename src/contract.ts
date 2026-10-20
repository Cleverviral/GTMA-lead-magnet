import { z } from 'zod';

const id = z.union([z.string(), z.number()]).transform(String);
const anyRecord = z.record(z.any());

const ManifestEntry = z.object({
  key: z.string().min(1),
  source: z.string().nullish(),
  required: z.boolean().default(true),
  fallback: z.any().nullish(),
});

const Integration = z
  .object({
    base_url: z.string().url(),
    auth_kind: z.string().default('api_key'),
    auth_header: z.string().nullish(),
    credential: z.string().min(1),
    endpoint_path: z.string().nullish(),
    test_mode: z
      .object({
        available: z.boolean().default(false),
        how: z.string().nullish(),
        name: z.string().nullish(),
        value: z.any().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

// A company that matters to the prospect (rulings 63-64, 68a). GTMA may send them already found;
// otherwise the service runs the finders itself when the recipe lists the finder keys.
const RelatedCompany = z
  .object({
    name: z.string().min(1),
    domain: z.string().nullish(),
    linkedin_url: z.string().nullish(),
    industry: z.string().nullish(),
    employee_count: z.number().nullish(),
    hq_country: z.string().nullish(),
    found_by: z.enum(['case_study', 'lookalike', 'target_market']),
    like: z.string().nullish(),
    inputs: anyRecord.default({}),
    unavailable_inputs: z.array(z.string()).default([]),
  })
  .passthrough();

const Fixture = z
  .object({
    person_id: id,
    lead_list_id: id.nullish(),
    reply_id: id.nullish(),
    first_name: z.string().nullish(),
    full_name: z.string().nullish(),
    company: anyRecord.default({}),
    inputs: anyRecord.default({}),
    // manifest keys that could not be obtained: their sections are omitted or reshaped, never invented
    unavailable_inputs: z.array(z.string()).default([]),
    related_companies: z.array(RelatedCompany).nullish(),
  })
  .passthrough();

// The autoresponder's whole request at reply time: a lead reference, nothing else.
export const ReplyRequest = z.object({
  sequencer: z.string().min(1),
  sequencer_campaign_id: id,
  sequencer_lead_id: id,
  reply_id: id.nullish(),
  idempotency_key: z.string().min(1).nullish(),
});

export const BuildPayload = z
  .object({
    lead_magnet_id: id,
    runtime_id: id.nullish(),
    runtime_version: z.number().int().nullish(),
    gtm_play_id: id.nullish(),
    idempotency_key: z.string().min(1),
    callback_url: z.string().url().nullish(),
    recipe: z
      .object({
        skill_md: z.string().min(1),
        play_constants: anyRecord.nullish().transform((v) => v ?? {}),
        input_manifest: z.array(ManifestEntry).nullish(),
        output_contract: z
          .object({
            deliverable: z.string().default('html_link'),
            pre_send_checks: z.array(z.string()).default([]),
            expected_turnaround_minutes: z.number().positive().default(10),
          })
          .passthrough()
          .default({}),
        failure_policy: z
          .object({
            retries: z.number().int().min(0).max(5).default(2),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
    magnet: z
      .object({
        kind: z.enum(['custom', 'external']),
        name: z.string().nullish(),
        promise: z.array(z.string()).default([]),
        description: z.string().default(''),
        hosting: z.enum(['ours', 'client_domain']).default('ours'),
        hosted_base_url: z.string().nullish(),
        integration: Integration.nullish(),
      })
      .passthrough(),
    // The play this magnet serves: its angle feeds "What <prospect> could do with this" (ruling 70)
    // and the target-market finder. Optional; looked up by gtm_play_id when absent.
    play: z
      .object({
        name: z.string().nullish(),
        summary: z.string().nullish(),
        offer: z.string().nullish(),
        reply_guidance: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    client: z
      .object({
        client_id: id.nullish(),
        client_name: z.string().min(1),
        website: z.string().nullish(),
        // hex colours, or {"default": true} = the operator chose the house default (ruling 54a)
        brand_colors: z
          .record(z.any())
          .nullish()
          .transform((v) => v ?? {}),
        logo_url: z.string().nullish(),
        booking_url: z.string().nullish(),
        booking_poc_name: z.string().nullish(),
      })
      .passthrough(),
    proofpoints: z
      .array(
        z
          .object({
            kind: z.string().nullish(),
            statement: z.string().min(1),
          })
          .passthrough(),
      )
      .default([]),
    // The client's own resources (API docs, guides, tools): the carousel's fallback when there are
    // no approved case studies (ruling 57). Never filler from the magnet's own description.
    resources: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().nullish(),
            url: z.string().url(),
            kind: z.string().nullish(),
          })
          .passthrough(),
      )
      .default([]),
    fixtures: z.array(Fixture).min(1).max(10),
  })
  .superRefine((p, ctx) => {
    if (p.magnet.kind === 'external' && !p.magnet.integration) {
      ctx.addIssue({ code: 'custom', path: ['magnet', 'integration'], message: 'external magnets need magnet.integration' });
    }
    if (p.magnet.hosting === 'client_domain' && !isHttpUrl(p.magnet.hosted_base_url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['magnet', 'hosted_base_url'],
        message: "hosting='client_domain' needs the verified subdomain as hosted_base_url",
      });
    }
  });

export function isHttpUrl(s: unknown): s is string {
  if (!s || typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
