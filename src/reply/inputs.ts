// The input waterfall for one replying lead. Free sources first, in order: the lead row's
// enrichments_used, the companies/people fact columns, the shared enrichment cache. Only a
// generation_time key that none of them hold triggers a paid tool call (via data_keys/route_keys).
import {
  findActiveEnrichmentRoutes,
  findCachedEnrichment,
  findDataKey,
  findEnrichTools,
  findRouteInputs,
  type LeadRow,
  type ManifestRow,
} from '../gtma.js';
import { isPresent } from '../manifest.js';
import { callTool } from './vendors.js';

const COMPANY_FACTS: Record<string, string> = {
  company_name: 'company_name',
  company_domain: 'primary_domain',
  company_primary_domain: 'primary_domain',
  company_industry: 'industry',
  company_employee_count: 'employees_on_linkedin',
  company_employees_on_linkedin: 'employees_on_linkedin',
  company_about: 'about',
  company_specialties: 'specialties',
  company_website: 'website',
  company_linkedin_url: 'linkedin_url',
  company_linkedin_id: 'linkedin_id',
  company_hq_city: 'hq_city',
  company_hq_state: 'hq_state',
  company_hq_country: 'hq_country',
  company_size_band: 'size_band',
  company_founded_year: 'founded_year',
  company_followers: 'followers',
  company_type: 'company_type',
};

const PERSON_FACTS: Record<string, string> = {
  person_full_name: 'full_name',
  person_first_name: 'first_name',
  person_last_name: 'last_name',
  person_about: 'about',
  person_city: 'city',
  person_country: 'country',
  person_linkedin_url: 'linkedin_url',
  person_connections_count: 'connections_count',
};

export interface WaterfallContext {
  // The replying lead, or a related company stood in its place (no person, no email).
  lead: Pick<LeadRow, 'enrichments_used' | 'email' | 'company_id'> & { person_id: string | null };
  company: Record<string, unknown> | null;
  person: Record<string, unknown> | null;
  playConstants: Record<string, unknown>;
}

export interface InputResolution {
  values: Record<string, unknown>;
  sources: Record<string, string>;
  unavailable: { key: string; reason: string }[];
  missingRequired: string[];
}

async function freeValue(key: string, ctx: WaterfallContext): Promise<{ value: unknown; source: string } | null> {
  const onLead = ctx.lead.enrichments_used?.[key];
  if (isPresent(onLead)) return { value: onLead, source: 'lead_row' };
  if (key === 'person_email' && isPresent(ctx.lead.email)) return { value: ctx.lead.email, source: 'lead_row' };

  const fact = COMPANY_FACTS[key] ? ctx.company?.[COMPANY_FACTS[key]] : PERSON_FACTS[key] ? ctx.person?.[PERSON_FACTS[key]] : undefined;
  if (isPresent(fact)) return { value: fact, source: 'fact_column' };

  const entityId = key.startsWith('company_') ? ctx.lead.company_id : key.startsWith('person_') ? ctx.lead.person_id : null;
  if (entityId) {
    const cached = await findCachedEnrichment(key.startsWith('company_') ? 'company' : 'person', entityId, key);
    if (isPresent(cached)) return { value: cached, source: 'enrichment_cache' };
  }
  return null;
}

async function paidValue(key: string, ctx: WaterfallContext): Promise<{ value: unknown; source: string } | { reason: string }> {
  if (!(await findDataKey(key))) return { reason: 'not in data_keys (no route can supply it)' };
  const routes = await findActiveEnrichmentRoutes(key);
  if (!routes.length) return { reason: 'no active enrichment route returns it' };

  const reasons: string[] = [];
  for (const route of routes) {
    const ins = await findRouteInputs(route.route_id);
    const groups = new Map<number, typeof ins>();
    for (const i of ins) groups.set(i.input_group ?? 0, [...(groups.get(i.input_group ?? 0) ?? []), i]);

    let inputs: Record<string, unknown> | null = null;
    for (const group of groups.values()) {
      const vals: Record<string, unknown> = {};
      let complete = true;
      for (const i of group) {
        const v = await freeValue(i.key, ctx);
        if (v) vals[i.key] = v.value;
        else if (i.is_required) complete = false;
      }
      if (complete) {
        inputs = vals;
        break;
      }
    }
    if (!inputs) {
      reasons.push(`${route.route_code}: the lead lacks the route's inputs (${ins.map((i) => i.key).join(', ')})`);
      continue;
    }

    for (const tool of await findEnrichTools(route.route_id)) {
      const out = await callTool(tool, inputs);
      if (out.ok) return { value: out.value, source: `tool:${tool.tool_id}` };
      reasons.push(out.reason);
    }
  }
  return { reason: reasons.join('; ') || 'no tool could supply it' };
}

export async function resolveManifest(manifest: ManifestRow[], ctx: WaterfallContext): Promise<InputResolution> {
  const res: InputResolution = { values: {}, sources: {}, unavailable: [], missingRequired: [] };
  for (const entry of manifest) {
    const { key } = entry;
    if (entry.source === 'play_constant') {
      const v = ctx.playConstants[key];
      if (isPresent(v)) {
        res.values[key] = v;
        res.sources[key] = 'play_constant';
      } else res.unavailable.push({ key, reason: 'play constant not set on the runtime' });
      continue;
    }

    const free = await freeValue(key, ctx);
    if (free) {
      res.values[key] = free.value;
      res.sources[key] = free.source;
      continue;
    }
    // lead_list keys are guaranteed by the go-live gate; a required one missing means the gate was bypassed.
    if (entry.source === 'lead_list') {
      if (entry.required !== false) res.missingRequired.push(key);
      else res.unavailable.push({ key, reason: 'not on the lead row' });
      continue;
    }

    const paid = await paidValue(key, ctx);
    if ('value' in paid) {
      res.values[key] = paid.value;
      res.sources[key] = paid.source;
    } else if (isPresent(entry.fallback)) {
      res.values[key] = entry.fallback;
      res.sources[key] = 'manifest_fallback';
    } else {
      res.unavailable.push({ key, reason: paid.reason });
    }
  }
  return res;
}
