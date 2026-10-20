import type { z } from 'zod';
import type { BuildPayload } from './contract.js';

export type Payload = z.infer<typeof BuildPayload>;
export type Fixture = Payload['fixtures'][number];
export type Endpoint = 'build-previews' | 'produce';

export interface ManifestEntry {
  key: string;
  source?: string | null;
  required: boolean;
  fallback?: unknown;
}

export interface ResolvedInputs {
  values: Record<string, unknown>;
  missingRequired: string[];
  usedFallback: string[];
}

export interface Colors {
  fromClient: boolean;
  accent: string;
  accent2: string;
  tag: string;
  ink: string;
  mut: string;
  line: string;
  bg: string;
}

export type RelatedCompany = NonNullable<Fixture['related_companies']>[number];

export interface CtaInfo {
  href: string;
  poc: string | null;
  fallbackUsed: boolean;
}

export type LogoResult =
  | { ok: true; source: string; dataUri: string; hasTransparency: boolean }
  | { ok: false; reason: string; source?: null };

export type ContentBlock =
  | { type: 'section'; heading: string; intro: string | null }
  | { type: 'paragraph'; text: string }
  | { type: 'stats'; items: { value: string; label: string }[] }
  | { type: 'bars'; heading: string | null; base: string | null; scale: 'percent' | 'relative'; items: { label: string; value: number; display: string }[] }
  | {
      type: 'company';
      index: number;
      base: string | null;
      items: { label: string; value: number; display: string }[];
      note: string;
    }
  | { type: 'cards'; items: { title: string; body: string }[] }
  | { type: 'list'; style: 'bullet' | 'check' | 'number'; items: string[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'score'; label: string; value: number; max: number; verdict: string }
  | { type: 'callout'; text: string };

export interface PageContent {
  missing_required_inputs: string[];
  page_title: string;
  topbar_label: string;
  headline: string;
  subheadline: string;
  blocks: ContentBlock[];
  actions: { title: string; body: string; team: string }[];
  proof_heading: string;
  proofpoint_indexes: number[];
  closing_heading: string;
  closing_body: string;
}

export interface ExternalRequestSpec {
  missing_required_inputs: string[];
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  query: { name: string; value: string }[];
  headers: { name: string; value: string }[];
  body_json: string | null;
  auth_location: 'header' | 'query' | 'bearer';
  auth_name: string;
  test_mode_applied: boolean;
  response_url_field: string;
  response_required_fields: { path: string; array_length: number | null }[];
  url_suffix: string | null;
}

export interface ExternalCallResult {
  status: 'produced' | 'failed';
  url: string | null;
  checks: Record<string, boolean>;
  notes: string[];
  failure_reason: string | null;
  artifactMayExist: boolean;
  authFailed: boolean;
}

export interface FixtureResult {
  person_id: string;
  lead_list_id: string | null;
  status: 'produced' | 'failed';
  url: string | null;
  latency_ms: number;
  checks: Record<string, boolean>;
  failure_reason: string | null;
  notes: string[];
  cached?: boolean;
  // external only: the client tool answered 2xx, so a real artifact may exist there (never re-POST blindly)
  artifact_may_exist?: boolean;
  // related-companies magnets: which companies the page shows and how they were found
  related?: {
    basis: 'case_study' | 'target_market' | 'mixed' | 'none' | 'given';
    companies: { name: string; found_by: 'case_study' | 'lookalike' | 'target_market'; like: string | null }[];
  };
}

export interface BuildResponse {
  lead_magnet_id: string;
  runtime_id: string | null;
  runtime_version: number | null;
  results: FixtureResult[];
}

export interface StoredResult {
  dedupeKey: string;
  endpoint: Endpoint;
  kind: 'custom' | 'external';
  leadMagnetId: string;
  runtimeId: string | null;
  runtimeVersion: number | null;
  gtmPlayId: string | null;
  personId: string;
  replyId: string | null;
  status: 'produced' | 'failed';
  token: string | null;
  url: string | null;
  html: string | null;
  result: FixtureResult;
}
