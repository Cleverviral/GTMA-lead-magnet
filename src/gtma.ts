// GTMA's database. Read-only for everything except the generator's own run log in
// magnet_productions (the one GTMA table the service writes).
import postgres from 'postgres';
import { config } from './config.js';

export const gtma = postgres(config.gtmaDatabaseUrl, { max: 5, idle_timeout: 20, onnotice: () => {} });

type Json = Record<string, unknown>;

export interface LeadRow {
  lead_list_id: string;
  person_id: string;
  company_id: string | null;
  email: string | null;
  enrichments_used: Json | null;
  client_id: string;
  sub_profile_id: string;
  gtm_play_id: string;
  gtm_play_name: string;
  gtm_play_summary: string | null;
  gtm_play_offer: string | null;
  lead_magnet_id: string | null;
  magnet_reply_guidance: string | null;
  sequencer: string | null;
  client_name: string;
  sub_profile_name: string;
  product_website: string | null;
  booking_url: string | null;
  booking_poc_name: string | null;
  brand_colors: Record<string, string> | null;
  logo_url: string | null;
}

export async function findLeads(campaignId: string, leadId: string): Promise<LeadRow[]> {
  return gtma<LeadRow[]>`
    select pll.id::text as lead_list_id, pll.person_id, pll.company_id, pll.email, pll.enrichments_used,
           pll.client_id, pll.sub_profile_id, pll.gtm_play_id, g.gtm_play_name, g.gtm_play_summary,
           g.gtm_play_offer, g.lead_magnet_id,
           g.magnet_reply_guidance, sp.sequencer, sp.client_name, sp.sub_profile_name, sp.product_website,
           sp.booking_url, sp.booking_poc_name, sp.brand_colors, sp.logo_url
      from play_lead_lists pll
      join gtm_plays g on g.gtm_play_id = pll.gtm_play_id
      join client_sub_profiles sp on sp.sub_profile_id = pll.sub_profile_id
     where pll.sequencer_campaign_id = ${campaignId} and pll.sequencer_lead_id = ${leadId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export interface PlayContext {
  name: string | null;
  summary: string | null;
  offer: string | null;
  reply_guidance: string | null;
}

export async function findPlayContext(playId: string): Promise<PlayContext | null> {
  if (!isUuid(playId)) return null;
  const [row] = await gtma<PlayContext[]>`
    select gtm_play_name as name, gtm_play_summary as summary, gtm_play_offer as offer, magnet_reply_guidance as reply_guidance
      from gtm_plays where gtm_play_id = ${playId}`;
  return row ?? null;
}

export async function findMagnetOwner(magnetId: string): Promise<{ client_id: string; sub_profile_id: string | null } | null> {
  if (!isUuid(magnetId)) return null;
  const [row] = await gtma<{ client_id: string; sub_profile_id: string | null }[]>`
    select client_id, sub_profile_id from lead_magnets where lead_magnet_id = ${magnetId}`;
  return row ?? null;
}

// The client's do-not-contact list (ruling 67a): related companies on it are never shown.
export async function findDncValues(clientId: string): Promise<string[]> {
  if (!isUuid(clientId)) return [];
  const rows = await gtma<{ dnc_value: string }[]>`select dnc_value from dnc_list where client_id = ${clientId}`;
  return rows.map((r) => r.dnc_value);
}

export async function findCompanyIdByLinkedin(linkedinUrl: string): Promise<string | null> {
  const [row] = await gtma<{ company_id: string }[]>`
    select company_id from company_aliases
     where alias_key = 'company_linkedin_url' and rtrim(alias_value, '/') = rtrim(${linkedinUrl}, '/') limit 1`;
  return row?.company_id ?? null;
}

export interface ResourceRow {
  title: string;
  description: string | null;
  url: string;
  kind: string;
}

// The client's own resources for the carousel fallback (ruling 57): assets with a public link.
export async function findResources(clientId: string, subProfileId: string | null): Promise<ResourceRow[]> {
  if (!isUuid(clientId)) return [];
  return gtma<ResourceRow[]>`
    select title, summary as description, source_url as url, asset_type as kind from assets
     where client_id = ${clientId} and (sub_profile_id is null or sub_profile_id = ${subProfileId})
       and gtm_play_id is null and source_url is not null and status in ('ready', 'pending', 'extracting')
     order by (asset_type = 'case_study') desc, (asset_type = 'api_docs') desc, created_at
     limit 6`;
}

export interface MagnetRow {
  lead_magnet_id: string;
  lead_magnet_name: string;
  magnet_kind: 'custom' | 'external';
  fulfillment_mode: string;
  status: string;
  description: string;
  promise: string[];
  hosting: 'ours' | 'client_domain';
  hosted_base_url: string | null;
  integration_id: string | null;
  endpoint_path: string | null;
  runtime_status: string;
  current_runtime_version: number | null;
}

export async function findMagnet(id: string): Promise<MagnetRow | null> {
  const [row] = await gtma<MagnetRow[]>`
    select lead_magnet_id, lead_magnet_name, magnet_kind, fulfillment_mode, status, description, promise,
           hosting, hosted_base_url, integration_id, endpoint_path, runtime_status, current_runtime_version
      from lead_magnets where lead_magnet_id = ${id}`;
  return row ?? null;
}

export interface ManifestRow {
  key: string;
  source: 'lead_list' | 'generation_time' | 'play_constant';
  required?: boolean;
  fallback?: unknown;
}

export interface RuntimeRow {
  runtime_id: string;
  version: number;
  skill_md: string;
  input_manifest: ManifestRow[];
  play_constants: Json;
  qa_prompt: string;
  output_contract: Json;
  failure_policy: { retries?: number } | null;
}

export async function findApprovedRuntime(magnetId: string, version: number): Promise<RuntimeRow | null> {
  const [row] = await gtma<RuntimeRow[]>`
    select runtime_id, version, skill_md, input_manifest, play_constants, qa_prompt, output_contract, failure_policy
      from lead_magnet_runtimes
     where lead_magnet_id = ${magnetId} and version = ${version} and status = 'approved'`;
  return row ?? null;
}

export async function findProofpoints(subProfileId: string): Promise<{ kind: string; statement: string }[]> {
  return gtma`select kind, statement from proofpoints where sub_profile_id = ${subProfileId} and approved order by kind`;
}

export async function findIntegration(id: string): Promise<{ base_url: string; auth_kind: string; credential_ref: string | null; test_mode: Json | null } | null> {
  const [row] = await gtma<{ base_url: string; auth_kind: string; credential_ref: string | null; test_mode: Json | null }[]>`
    select base_url, auth_kind, credential_ref, test_mode from client_integrations where integration_id = ${id} and status = 'active'`;
  return row ?? null;
}

export async function findCompanyFacts(companyId: string, subProfileId: string): Promise<Json | null> {
  const [row] = await gtma<Json[]>`
    select company_name, primary_domain, industry, employees_on_linkedin, about, specialties, website, linkedin_url,
           linkedin_id, hq_city, hq_state, hq_country, size_band, founded_year, followers, company_type
      from companies where company_id = ${companyId} and sub_profile_id = ${subProfileId} limit 1`;
  return row ?? null;
}

export async function findPersonFacts(personId: string, subProfileId: string): Promise<Json | null> {
  const [row] = await gtma<Json[]>`
    select pi.first_name, pi.last_name, pi.full_name, p.about, p.city, p.country, p.linkedin_url, p.connections_count
      from person_index pi
      left join people p on p.person_id = pi.person_id and p.sub_profile_id = ${subProfileId}
     where pi.person_id = ${personId} limit 1`;
  return row ?? null;
}

export async function findCachedEnrichment(scope: 'company' | 'person', entityId: string, key: string): Promise<unknown> {
  const rows =
    scope === 'company'
      ? await gtma<{ value: unknown }[]>`select value from company_enrichments where company_id = ${entityId} and key = ${key} and is_current limit 1`
      : await gtma<{ value: unknown }[]>`select value from person_enrichments where person_id = ${entityId} and key = ${key} and is_current limit 1`;
  return rows[0]?.value;
}

export async function findDataKey(key: string): Promise<{ key: string; scope: string } | null> {
  const [row] = await gtma<{ key: string; scope: string }[]>`select key, scope from data_keys where key = ${key}`;
  return row ?? null;
}

export interface RouteRow {
  route_id: string;
  route_code: string;
}

export async function findActiveEnrichmentRoutes(key: string): Promise<RouteRow[]> {
  return gtma<RouteRow[]>`
    select r.route_id, r.route_code from route_keys rk join data_routes r using (route_id)
     where rk.key = ${key} and rk.direction = 'out' and r.status = 'active' and r.purpose = 'enrichment'
     order by r.route_code`;
}

export async function findRouteInputs(routeId: string): Promise<{ key: string; input_group: number | null; is_required: boolean }[]> {
  return gtma`select key, input_group, is_required from route_keys where route_id = ${routeId} and direction = 'in'`;
}

export interface ToolRow {
  tool_id: string;
  vendor: string;
  method: string | null;
  path: string | null;
  credential_ref: string | null;
  status: string;
}

export async function findEnrichTools(routeId: string): Promise<ToolRow[]> {
  return gtma<ToolRow[]>`
    select t.tool_id, t.vendor, t.method, t.path, t.credential_ref, t.status
      from route_tools rt join data_tools t using (tool_id)
     where rt.route_id = ${routeId} and rt.role = 'enrich'
     order by rt.is_fallback, rt.step_order`;
}

// magnet_productions.reply_id is a real foreign key into replies; a caller-supplied id that
// doesn't exist there must never reach the insert (ruling 52's one write would crash on it).
export async function replyExists(replyId: string): Promise<boolean> {
  const [row] = await gtma<{ x: number }[]>`select 1 x from replies where reply_id = ${replyId}`;
  return Boolean(row);
}

export async function findInterestedReply(personId: string, playId: string): Promise<string | null> {
  const [row] = await gtma<{ reply_id: string }[]>`
    select reply_id::text from replies
     where person_id = ${personId} and gtm_play_id = ${playId} and category = 'interested'
     order by replied_at desc limit 1`;
  return row?.reply_id ?? null;
}

export async function findProducedForReply(magnetId: string, personId: string, replyId: string): Promise<{ production_id: string; output: Json } | null> {
  const [row] = await gtma<{ production_id: string; output: Json }[]>`
    select production_id, output from magnet_productions
     where lead_magnet_id = ${magnetId} and person_id = ${personId} and reply_id = ${replyId} and status = 'produced'`;
  return row ?? null;
}

export interface ProductionLog {
  lead_magnet_id: string;
  lead_magnet_name: string;
  magnet_version: number;
  client_id: string;
  client_name: string;
  sub_profile_id: string;
  sub_profile_name: string;
  gtm_play_id: string;
  gtm_play_name: string;
  person_id: string;
  company_id: string | null;
  reply_id: string | null;
  trigger: 'positive_reply' | 'manual';
  status: 'produced' | 'failed';
  inputs_used: Json;
  output: Json;
  failure_reason: string | null;
}

// The generator's only write to GTMA (ruling 52). A retry for the same reply updates its row.
export async function logProduction(p: ProductionLog): Promise<string> {
  const producedAt = p.status === 'produced' ? new Date() : null;
  const [row] = await gtma<{ production_id: string }[]>`
    insert into magnet_productions
      (lead_magnet_id, lead_magnet_name, magnet_version, client_id, client_name, sub_profile_id, sub_profile_name,
       gtm_play_id, gtm_play_name, person_id, company_id, reply_id, trigger, status, inputs_used, output,
       produced_by, generator_version, produced_at, failure_reason)
    values
      (${p.lead_magnet_id}, ${p.lead_magnet_name}, ${p.magnet_version}, ${p.client_id}, ${p.client_name},
       ${p.sub_profile_id}, ${p.sub_profile_name}, ${p.gtm_play_id}, ${p.gtm_play_name}, ${p.person_id},
       ${p.company_id}, ${p.reply_id}, ${p.trigger}, ${p.status},
       ${gtma.json(p.inputs_used as postgres.JSONValue)}, ${gtma.json(p.output as postgres.JSONValue)},
       ${`runtime v${p.magnet_version}`}, ${config.generatorVersion}, ${producedAt}, ${p.failure_reason})
    on conflict (lead_magnet_id, person_id, reply_id) where reply_id is not null
    do update set status = excluded.status, inputs_used = excluded.inputs_used, output = excluded.output,
                  produced_by = excluded.produced_by, generator_version = excluded.generator_version,
                  produced_at = excluded.produced_at, failure_reason = excluded.failure_reason
    returning production_id`;
  return row!.production_id;
}
