// The two finders (rulings 64, 66-69, 71; skills/finders/README.md): three companies that matter
// to the prospect, never the prospect itself. Finder 1 reads the prospect's own case-study pages;
// 2a adds lookalikes of any brand found there; 2b reads who the prospect says they serve, only
// when no brand was found at all. Ported from magnet-service-tool-kit/related-companies-test.
import fs from 'node:fs';
import path from 'node:path';
import { getPublic } from '../logo.js';
import { structured, S } from '../llm.js';
import { visibleText } from '../text.js';
import { searchCompanies, type BlitzCompany, type DeptDistribution } from './blitz.js';

export const FINDER_KEYS = ['company_case_study_customers', 'company_target_market'] as const;
export const isFinderKey = (k: string): boolean => (FINDER_KEYS as readonly string[]).includes(k);
export const RELATED_COUNT = 3;
export const MIN_TEAM_COVERAGE = 0.2; // ruling 69

// Ruling 63a: listing the finder keys in the inputs IS what makes a related-companies magnet.
export function isRelatedManifest(manifest: { key: string }[] | null | undefined): boolean {
  return (manifest ?? []).some((e) => isFinderKey(e.key));
}

// In a related-companies magnet, a company_* key the lead does not carry describes each FOUND
// company (e.g. company_dept_distribution); lead_list keys stay the prospect's own.
export function splitManifest<T extends { key: string; source?: string | null }>(manifest: T[], related: boolean): { prospect: T[]; perCompany: T[] } {
  const perCompany = related
    ? manifest.filter((e) => !isFinderKey(e.key) && e.key.startsWith('company_') && !/lead_list/i.test(e.source ?? ''))
    : [];
  const prospect = manifest.filter((e) => !isFinderKey(e.key) && !perCompany.includes(e));
  return { prospect, perCompany };
}

export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Ruling 71: "as featured in" media logos are never customers.
const PRESS = new Set(
  [
    'BBC', 'BBC News', 'CNN', 'CNBC', 'NBC', 'CBS', 'ABC News', 'Fox Business', 'Fox News', 'NPR', 'Reuters', 'AP',
    'Associated Press', 'Bloomberg', 'Forbes', 'Fortune', 'Inc', 'Inc.', 'Inc Magazine', 'Fast Company', 'TechCrunch',
    'VentureBeat', 'Wired', 'The Verge', 'Axios', 'Business Insider', 'Insider', 'The New York Times', 'New York Times',
    'NYT', 'The Wall Street Journal', 'Wall Street Journal', 'WSJ', 'The Washington Post', 'Washington Post', 'USA Today',
    'The Guardian', 'Financial Times', 'FT', 'The Economist', 'Yahoo Finance', 'Yahoo', 'MarketWatch', 'Entrepreneur',
    'Harvard Business Review', 'HBR', 'Mashable', 'ZDNet', 'Engadget', 'The Atlantic', 'Time', 'Newsweek', 'Politico',
    'Los Angeles Times', 'Chicago Tribune', 'The Telegraph', 'The Times', 'Daily Mail', 'Product Hunt', 'Gartner',
    'Forrester', 'G2', 'Capterra', 'Trustpilot',
  ].map(norm),
);

const UA_FURNITURE = new Set(['arrow', 'search', 'close', 'shape', 'play', 'quote', 'plus', 'minus', 'menu', 'feed', 'logo', 'icon', 'image', 'linkedin', 'twitter', 'facebook', 'youtube', 'instagram']);
const KEY = /(customer|case[-_ ]?stud|success[-_ ]?stor|client|testimonial)/i;
const BAD = /(login|sign|careers|privacy|terms|support|portal|cookie|contact|mailto|#)/i;
const GENERIC = /^(burger chain|top \d+|chain|brand|client|customer)s?$/i;

export interface FoundCompany extends BlitzCompany {
  found_by: 'case_study' | 'lookalike' | 'target_market';
  like?: string;
  dept: { value: DeptDistribution; source: string };
}

export interface FinderEnv {
  dnc: Set<string>; // normalized do-not-contact values (domains, LinkedIn URLs, names)
  dept(c: BlitzCompany): Promise<{ value: DeptDistribution; source: string } | null>;
  play?: Record<string, unknown> | null;
}

export interface FinderResult {
  companies: FoundCompany[];
  basis: 'case_study' | 'target_market' | 'mixed' | 'none';
  trace: string[];
}

interface Page {
  url: string;
  html: string;
}

async function fetchHtml(url: string): Promise<Page | null> {
  try {
    const r = await getPublic(url, 3_000_000, 15_000);
    return r.status === 200 && r.ctype.includes('html') ? { url: r.finalUrl, html: r.data.toString('utf8') } : null;
  } catch {
    return null;
  }
}

async function readSite(domain: string): Promise<{ home: Page | null; pages: Page[] }> {
  const home = (await fetchHtml(`https://www.${domain}/`)) ?? (await fetchHtml(`https://${domain}/`));
  if (!home) return { home: null, pages: [] };
  const links: string[] = [];
  for (const m of home.html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!;
    const label = m[2]!.replace(/<[^>]+>/g, ' ');
    if (!KEY.test(`${href} ${label}`) || BAD.test(href)) continue;
    try {
      const u = new URL(href, home.url);
      if (u.hostname.replace(/^www\./, '') === domain && !links.includes(u.toString())) links.push(u.toString());
    } catch {
      /* bad href */
    }
  }
  const pages = (await Promise.all(links.slice(0, 4).map(fetchHtml))).filter((p): p is Page => p !== null);
  return { home, pages };
}

// Candidate customer names from the prospect's own customer / case-study pages.
export function rawCandidates(domain: string, pages: Page[]): string[] {
  const root = domain.split('.')[0]!.toLowerCase();
  const names = new Set<string>();
  for (const { url, html } of pages) {
    for (const m of html.matchAll(/<img[^>]+alt="([^"]{2,60})"/gi)) {
      const a = m[1]!
        .replace(/&amp;/g, '&')
        .replace(/\b(logo|logotype|icon|image|customer|client)\b/gi, '')
        .replace(/^[\s\-|:]+|[\s\-|:]+$/g, '')
        .trim();
      if (a.length > 2 && a.length < 40 && !a.toLowerCase().includes(root) && !UA_FURNITURE.has(a.toLowerCase())) names.add(a);
    }
    // case-study pages named after the customer: /case-studies/barilla/, /resource/caseys-elevate-case-study/
    for (const m of html.matchAll(/href="[^"]*\/(?:case-stud(?:y|ies)|customers|customer-stories|success-stories|resource)\/([a-z0-9-]{3,70})\/?(?:#[^"]*)?"/g)) {
      const slug = m[1]!;
      if (html.includes('/resource/') && !/case|stor/.test(slug) && !url.includes('case-stud')) continue;
      const n = slug
        .replace(/-?(elevate-)?(case-study|customer-story|story)$/, '')
        .replace(/^top-\d+-/, '')
        .replace(/-/g, ' ')
        .trim();
      if (n && !/^(page|category|tag|all|index|feed)$/i.test(n)) names.add(n.replace(/\b\w/g, (c) => c.toUpperCase()));
    }
    // featured story headlines: "How Lovesac built ..."
    for (const m of visibleText(html).matchAll(/How ([A-Z][A-Za-z0-9&'. ]{1,30}?) (?:built|used|uses|cut|grew|scaled|turned|reduced|increased|achieved)/g)) {
      names.add(m[1]!.trim());
    }
  }
  return [...names].filter((n) => !GENERIC.test(n) && !PRESS.has(norm(n)));
}

const CLEAN_SCHEMA = S.obj({ customers: S.arr(S.str) });

// One model pass to clean the scraped list (the kit's production note: many sites load their
// logos with JavaScript, so the raw list is noisy). It may only RETURN names it was given.
async function cleanCandidates(prospect: { name: string; domain: string }, raw: string[]): Promise<string[]> {
  if (!raw.length) return [];
  let cleaned: string[];
  try {
    const out = await structured<{ customers: string[] }>({
      system: `You clean a list of names scraped from a company's own customer and case-study pages.
Return only the real customer organisations in the list, as company names.
Drop: generic labels (e.g. "Top 200 Burger Chain"), website furniture (icons, buttons, words like "arrow" or "quote"),
the company itself and its own products, partners and integrations that are not customers, and press or media outlets
shown as "as featured in" (BBC, The New York Times, Wall Street Journal, Forbes and similar).
Keep each name as it is written. You may only restore obvious capitalisation, spacing or an apostrophe lost in a URL
slug (e.g. "general mills" to "General Mills"). Never add a name that is not in the list.`,
      user: JSON.stringify({ company: prospect, scraped_names: raw }),
      name: 'case_study_customers',
      schema: CLEAN_SCHEMA,
    });
    cleaned = out.customers;
  } catch {
    cleaned = raw;
  }
  const allowed = new Set(raw.map(norm));
  return [...new Map(cleaned.filter((n) => allowed.has(norm(n)) && !PRESS.has(norm(n))).map((n) => [norm(n), n])).values()];
}

// Exact name match only: a fuzzy hit is dropped, never guessed.
async function resolveName(name: string): Promise<BlitzCompany | null> {
  const results = await searchCompanies({ keywords: { include: [name] } }, 5);
  return results.find((x) => norm(x.name) === norm(name)) ?? null;
}

const MARKET_SCHEMA = S.obj({
  label: S.str,
  evidence: S.str,
  industries: S.arr(S.str),
  keywords: S.arr(S.str),
  country_codes: S.arr(S.str),
});

let industriesCache: string[] | null = null;
function blitzIndustries(): string[] {
  industriesCache ??= fs.readFileSync(path.join(process.cwd(), 'data', 'blitz-industries.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  return industriesCache;
}

interface MarketQuery {
  label: string;
  evidence: string;
  industries: string[];
  keywords: string[];
  country_codes: string[];
}

// Finder 2b's reading step: who the prospect says they serve, mapped to a company search.
async function marketQuery(prospect: { name: string; domain: string; about?: string | null }, home: Page | null, play: FinderEnv['play']): Promise<MarketQuery | null> {
  const meta = home?.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  const copy = home ? visibleText(home.html).slice(0, 4000) : '';
  const allowed = blitzIndustries();
  let q: MarketQuery;
  try {
    q = await structured<MarketQuery>({
      system: `You read who a company says it serves and turn it into ONE company search for its target market:
the kind of company that BUYS what it sells. Never its competitors, never companies like itself.
- industries: 1 to 3 values copied exactly from the allowed industry list. Prefer the broad parent
  industry (e.g. "Insurance" over "Insurance Carriers"); add a narrower one only alongside it.
- keywords: 0 to 2 short keywords, only when the industry alone would pull in the wrong buyers. Prefer none.
- country_codes: ISO 3166 two-letter codes where those buyers are, from the evidence (default ["US"] when unclear).
- evidence: a short exact quote from the company's own text that says who it serves.
- label: a short plain name for that market, e.g. "food and beverage brands".
Allowed industries:
${allowed.join('\n')}`,
      user: JSON.stringify({ company: prospect, meta_description: meta, homepage_text: copy, gtm_play: play ?? null }),
      name: 'target_market_query',
      schema: MARKET_SCHEMA,
    });
  } catch {
    return null;
  }
  const valid = new Set(allowed);
  q.industries = q.industries.filter((i) => valid.has(i)).slice(0, 3);
  q.keywords = q.keywords.filter((k) => k.trim()).slice(0, 2);
  q.country_codes = q.country_codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return q.industries.length ? q : null;
}

const sizeOf = (x: BlitzCompany) => Math.max(1, x.employees_on_linkedin ?? 1);

export async function findRelated(prospect: { name: string; domain: string; about?: string | null }, env: FinderEnv): Promise<FinderResult> {
  const trace: string[] = [];
  const picked: FoundCompany[] = [];
  const pickedNames = () => new Set(picked.map((p) => norm(p.name)));

  const excluded = (x: BlitzCompany): boolean => {
    const host = (() => {
      try {
        return x.website ? new URL(x.website).hostname.replace(/^www\./, '') : '';
      } catch {
        return '';
      }
    })();
    const ids = [x.domain, host, x.linkedin_url, x.name].map(norm).filter(Boolean);
    return (
      norm(x.name) === norm(prospect.name) ||
      norm(x.domain) === norm(prospect.domain) ||
      (x.domain ?? '').toLowerCase().includes(prospect.domain.split('.')[0]!.toLowerCase()) ||
      ids.some((v) => env.dnc.has(v))
    );
  };

  // Ruling 69: used only when at least 20% of its LinkedIn people list a known team.
  const coverage = async (x: BlitzCompany): Promise<FoundCompany['dept'] | null> => {
    const d = await env.dept(x);
    if (!d?.value.distribution?.length) {
      trace.push(`skipped ${x.name}: no team data`);
      return null;
    }
    const known = d.value.total_employees ?? d.value.distribution.reduce((s, k) => s + k.count, 0);
    const cov = known / Math.max(1, x.employees_on_linkedin ?? known);
    if (cov < MIN_TEAM_COVERAGE) {
      trace.push(`skipped ${x.name}: ${Math.round(cov * 100)}% of its LinkedIn people list a team (minimum 20%)`);
      return null;
    }
    return d;
  };

  const take = async (pool: BlitzCompany[], found_by: FoundCompany['found_by'], like?: string): Promise<string[]> => {
    const added: string[] = [];
    for (const x of pool) {
      if (picked.length >= RELATED_COUNT) break;
      if (excluded(x) || pickedNames().has(norm(x.name)) || !x.linkedin_url) continue;
      const dept = await coverage(x);
      if (dept) {
        picked.push({ ...x, found_by, like, dept });
        added.push(x.name);
      }
    }
    return added;
  };

  // FINDER 1: case-study customers from the prospect's own site.
  const site = await readSite(prospect.domain);
  const names = (await cleanCandidates(prospect, rawCandidates(prospect.domain, site.pages))).slice(0, 25);
  const resolved = (await Promise.all(names.map((n) => resolveName(n).catch(() => null)))).filter((x): x is BlitzCompany => x !== null);
  resolved.sort((a, b) => sizeOf(b) - sizeOf(a));
  trace.push(`finder 1: read ${site.pages.length} customer page(s), ${names.length} name(s), ${resolved.length} exact match(es)`);
  const fromCases = await take(resolved, 'case_study');
  if (fromCases.length) trace.push(`case-study customers: ${fromCases.join(', ')}`);

  // FINDER 2a: lookalikes of any brand found (same industry and country, closest in size).
  const seeds: BlitzCompany[] = picked.length ? [...picked] : resolved.slice(0, 1);
  for (const seed of seeds) {
    if (picked.length >= RELATED_COUNT || !seed.industry) break;
    const q: Record<string, unknown> = { industry: { include: [seed.industry] } };
    if (seed.hq?.country_code) q.hq = { country_code: [seed.hq.country_code] };
    const pool = (await searchCompanies(q, 25)).filter((x) => norm(x.name) !== norm(seed.name));
    pool.sort((a, b) => Math.abs(Math.log(sizeOf(a) / sizeOf(seed))) - Math.abs(Math.log(sizeOf(b) / sizeOf(seed))));
    const added = await take(pool, 'lookalike', seed.name);
    if (added.length) trace.push(`lookalikes of ${seed.name}: ${added.join(', ')}`);
  }

  // FINDER 2b: target market, only when no brand at all was found on the prospect's site.
  if (picked.length < RELATED_COUNT && !seeds.length) {
    const mq = await marketQuery(prospect, site.home, env.play);
    if (mq) {
      const q: Record<string, unknown> = { industry: { include: mq.industries } };
      if (mq.country_codes.length) q.hq = { country_code: mq.country_codes };
      // Largest buyers first. Keywords narrow the pool; if that leaves too few usable companies,
      // search once more on the industry alone.
      const added: string[] = [];
      for (const keywords of mq.keywords.length ? [mq.keywords, []] : [[]]) {
        if (picked.length >= RELATED_COUNT) break;
        const pool = await searchCompanies(keywords.length ? { ...q, keywords: { include: keywords } } : q, 25);
        pool.sort((a, b) => sizeOf(b) - sizeOf(a));
        added.push(...(await take(pool, 'target_market')));
      }
      trace.push(
        `target market "${mq.label}" [${mq.industries.join(' | ')}${mq.keywords.length ? '; keywords ' + mq.keywords.join(', ') : ''}; ${mq.country_codes.join(',') || 'any country'}] (from: "${mq.evidence.slice(0, 120)}"): ${added.join(', ') || 'none usable'}`,
      );
    } else {
      trace.push('target market: could not read who the prospect serves');
    }
  }

  const kinds = new Set(picked.map((p) => p.found_by));
  const only = (k: FoundCompany['found_by']) => kinds.size === 1 && kinds.has(k);
  const basis: FinderResult['basis'] = !picked.length ? 'none' : only('case_study') ? 'case_study' : only('target_market') ? 'target_market' : 'mixed';
  return { companies: picked, basis, trace };
}
