// The Blitz calls the finders need (company search, department distribution). Capped at a few
// requests in flight: five previews finding companies at once would otherwise burst the key.
import { resolveCredential } from '../reply/vendors.js';

const BASE = 'https://api.blitz-api.ai';
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export interface BlitzCompany {
  name: string;
  domain?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  employees_on_linkedin?: number | null;
  about?: string | null;
  specialties?: string[] | null;
  hq?: { country_code?: string | null; country_name?: string | null } | null;
}

export interface DeptDistribution {
  total_employees?: number;
  distribution: { department: string; count: number; percentage_ratio: number }[];
}

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries rate limits (429), server errors and network failures; any other error status returns
// null at once. Every failure is logged so an empty search is never mistaken for "no companies".
async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const key = resolveCredential('BLITZ_API_KEY');
  if (!key) throw new Error('BLITZ_API_KEY is not configured on the generator');
  for (let attempt = 0; ; attempt++) {
    const outcome = await slot(async (): Promise<{ data: Record<string, unknown> } | { retryable: boolean; why: string; after?: number }> => {
      try {
        const res = await fetch(BASE + path, {
          method: 'POST',
          headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) return { data: (await res.json()) as Record<string, unknown> };
        const text = (await res.text().catch(() => '')).slice(0, 200);
        const after = Number(res.headers.get('retry-after'));
        return { retryable: res.status === 429 || res.status >= 500, why: `HTTP ${res.status} ${text}`, after: after > 0 ? after * 1000 : undefined };
      } catch (e) {
        return { retryable: true, why: (e as Error).message };
      }
    });
    if ('data' in outcome) return outcome.data;
    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(`[blitz] ${path} failed (${outcome.why})${outcome.retryable && delay ? `, retrying in ${Math.round((outcome.after ?? delay) / 1000)}s` : ''}`);
    if (!outcome.retryable || delay === undefined) return null;
    await wait(Math.min(outcome.after ?? delay, 30_000));
  }
}

export async function searchCompanies(company: Record<string, unknown>, maxResults: number): Promise<BlitzCompany[]> {
  const r = await post('/v2/search/companies', { company, max_results: maxResults });
  return (r?.results as BlitzCompany[] | undefined) ?? [];
}

export async function blitzDeptDistribution(linkedinUrl: string): Promise<DeptDistribution | null> {
  const r = await post('/v2/enrichment/company-distribution-by-department', { company_linkedin_url: linkedinUrl });
  if (!r || r.found === false || !Array.isArray(r.distribution)) return null;
  return { total_employees: r.total_employees as number | undefined, distribution: r.distribution as DeptDistribution['distribution'] };
}
