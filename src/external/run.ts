// External magnets, "Connect your own lead magnet" (skills/render-external-lead-magnet.md,
// rulings 72-86, 93, 95). The client's own tool makes the deliverable; we call its API once per
// company and take the link from the link field. No model involved: every request field is a
// GTMA data key value (no templates, no hand-typed values).
//   Logins: API key in a header, bearer token, username and password. Anything else stops.
//   Links only, in the same answer: text, files or job ids are not supported.
//   Checks per call: call succeeded, link field present, link opens, right company named.
// One call may create a real item in the client's tool: never a blind retry after a success.
import { isHttpUrl } from '../contract.js';
import { isPresent, lookup } from '../manifest.js';
import { visibleText } from '../text.js';
import type { ExternalCallResult, Fixture, Payload, ResolvedInputs } from '../types.js';

export const SUPPORTED_LOGINS = ['api_key', 'bearer', 'basic'] as const;
const LINK_WAIT_MS = 60_000;

export interface ExternalSpec {
  baseUrl: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  authKind: (typeof SUPPORTED_LOGINS)[number];
  header: string | null;
  credential: string;
  mapping: { field: string; data_key: string }[];
  linkField: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// The connection and the frozen recipe's request settings. Returns a plain message when the setup
// cannot be called (the same words the window shows).
export function externalSpec(payload: Payload): ExternalSpec | { error: string } {
  const integ = payload.magnet.integration;
  if (!integ) return { error: 'external magnets need magnet.integration' };
  const oc = payload.recipe.output_contract as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = oc[k] ?? (integ as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };

  const authKind = String(integ.auth_kind ?? '').toLowerCase();
  if (!(SUPPORTED_LOGINS as readonly string[]).includes(authKind)) {
    return { error: `This login method isn't supported yet (${authKind || 'none'}). Supported: API key, bearer token, username and password.` };
  }
  const endpoint = str(pick('endpoint_path', 'endpoint')) ?? str(payload.magnet.endpoint_path);
  if (!endpoint || !endpoint.startsWith('/')) return { error: 'the endpoint path is missing from the setup' };
  const method = (str(pick('method')) ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) return { error: `unsupported request method ${method}` };
  const header = str(pick('header', 'header_name', 'auth_header'));
  if (authKind === 'api_key' && !header) return { error: 'the API key header name is missing from the setup' };
  const parsed = (pick('request_mapping') as { field?: unknown; data_key?: unknown }[] | undefined) ?? [];
  const mapping = parsed.filter((m) => str(m?.field) && str(m?.data_key)).map((m) => ({ field: String(m.field), data_key: String(m.data_key) }));
  if (!mapping.length) return { error: 'the request mapping is missing: every field the API needs must map to a data key' };
  const linkField = str(pick('link_field'));
  if (!linkField) return { error: 'the link field is missing from the setup' };
  if (authKind === 'basic' && !integ.credential.includes(':')) return { error: 'username and password logins need the credential as username:password' };

  return { baseUrl: integ.base_url, endpoint, method: method as ExternalSpec['method'], authKind: authKind as ExternalSpec['authKind'], header, credential: integ.credential, mapping, linkField };
}

const pathGet = (obj: unknown, p: string): unknown =>
  p.split('.').filter(Boolean).reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const scrub = (s: unknown, secret: string): string => String(s ?? '').split(secret).join('[redacted]').slice(0, 300);

async function openLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (res.status >= 400) {
      await res.body?.cancel();
      return null;
    }
    return visibleText(await res.text());
  } catch {
    return null;
  }
}

// The request body (or query) for one company: each API field filled from its data key.
export function requestValues(spec: Pick<ExternalSpec, 'mapping'>, fixture: Fixture, resolved: ResolvedInputs, playConstants: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const m of spec.mapping) {
    const v = isPresent(resolved.values[m.data_key]) ? resolved.values[m.data_key] : lookup(m.data_key, fixture, playConstants);
    if (isPresent(v)) body[m.field] = v;
    else missing.push(m.field);
  }
  return { body, missing };
}

export interface CallArgs {
  spec: ExternalSpec;
  body: Record<string, unknown>;
  company: { name: string; domain: string | null };
  retries: number;
}

export async function callExternal({ spec, body, company, retries }: CallArgs): Promise<ExternalCallResult> {
  const secret = spec.credential;
  const notes: string[] = [];
  const fail = (reason: string, extra: Partial<ExternalCallResult> = {}): ExternalCallResult => ({
    status: 'failed', url: null, checks: {}, notes, failure_reason: scrub(reason, secret), artifactMayExist: false, authFailed: false, setWide: false, ...extra,
  });

  const base = new URL(spec.baseUrl);
  const target = new URL(spec.endpoint.replace(/^\/*/, '/'), base);
  if (target.origin !== base.origin) return fail('the endpoint path escapes the tool\'s base address', { setWide: true });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (spec.authKind === 'api_key') headers[spec.header!] = secret;
  else if (spec.authKind === 'bearer') headers.Authorization = `Bearer ${secret}`;
  else headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;

  let payloadBody: string | undefined;
  if (spec.method === 'GET') for (const [k, v] of Object.entries(body)) target.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  else {
    payloadBody = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  // 408/429/5xx before any success: back off and retry. A timeout may already have made the item
  // in the client's tool, so it is never retried.
  const t0 = Date.now();
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(target, { method: spec.method, headers, body: payloadBody, signal: AbortSignal.timeout(LINK_WAIT_MS) });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') return fail('the tool did not answer within a minute; an item may exist there, not retried', { artifactMayExist: true });
      if (attempt < retries) {
        await sleep(1000 * 3 ** attempt);
        continue;
      }
      return fail(`the tool is unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (([408, 429].includes(res.status) || res.status >= 500) && attempt < retries) {
      await res.body?.cancel();
      await sleep(1000 * 3 ** attempt);
      continue;
    }
    break;
  }
  const seconds = (Date.now() - t0) / 1000;
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    return fail(`The API key was refused by the tool (HTTP ${res.status}). Check the key saved in Settings.`, { authFailed: true, setWide: true });
  }
  if (res.status === 202) return fail('the tool answered later with a job id; only links returned in the same answer are supported', { artifactMayExist: true, setWide: true });
  if (!res.ok) return fail(`the tool answered HTTP ${res.status}: ${text}`);

  // From here on a real item may exist in the client's tool.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('the tool answered with text, not a link; only links are supported', { artifactMayExist: true, setWide: true });
  }
  const raw = pathGet(json, spec.linkField);
  const url = isHttpUrl(raw) ? raw : null;
  const page = url ? await openLink(url) : null;
  const lower = (page ?? '').toLowerCase();
  const named = Boolean(page) && [company.domain, company.name].some((v) => v && lower.includes(v.toLowerCase()));
  const checks: Record<string, boolean> = {
    call_succeeded: true,
    link_field_present: Boolean(url),
    link_opens: page !== null,
    right_company_named: named,
    same_answer_under_60s: seconds < 60,
  };
  if (!url) return { ...fail(`no link in the answer at "${spec.linkField}"; only links returned in the same answer are supported`, { artifactMayExist: true, setWide: true }), checks };
  if (!checks.link_opens) return { ...fail('the link the tool returned does not open', { artifactMayExist: true }), url, checks };
  if (!named) return { ...fail(`the page the tool made does not name ${company.name}`, { artifactMayExist: true }), url, checks };
  return { status: 'produced', url, checks, notes, failure_reason: null, artifactMayExist: true, authFailed: false, setWide: false };
}
