// Finds the related companies for one prospect, then resolves each found company's own inputs
// through the same cheapest-first waterfall the replying lead gets (its facts, the shared
// enrichment cache, then a paid route tool). Database reads only; a database hiccup degrades to
// "no cache, no do-not-contact list" rather than failing the page.
import { findCachedEnrichment, findCompanyIdByLinkedin, findDncValues, type ManifestRow } from '../gtma.js';
import { isPresent } from '../manifest.js';
import { resolveManifest } from '../reply/inputs.js';
import type { RelatedCompany } from '../types.js';
import { blitzDeptDistribution, type BlitzCompany } from './blitz.js';
import { findRelated, norm, type FinderEnv, type FinderResult } from './finders.js';

const DEPT = 'company_dept_distribution';

async function loadDnc(clientId: string | null | undefined): Promise<Set<string>> {
  if (!clientId) return new Set();
  try {
    return new Set((await findDncValues(clientId)).map(norm).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function companyIdOf(linkedinUrl: string): Promise<string | null> {
  try {
    return await findCompanyIdByLinkedin(linkedinUrl);
  } catch {
    return null;
  }
}

// Department distribution, cheapest first: the shared cache (another play may have bought it),
// then Blitz. Memoized per run: the same company can be weighed by more than one finder step.
function deptLookup(): FinderEnv['dept'] {
  const memo = new Map<string, ReturnType<FinderEnv['dept']>>();
  return (x: BlitzCompany) => {
    const li = x.linkedin_url;
    if (!li) return Promise.resolve(null);
    if (!memo.has(li)) {
      memo.set(
        li,
        (async () => {
          const id = await companyIdOf(li);
          if (id) {
            const cached = await findCachedEnrichment('company', id, DEPT).catch(() => null);
            if (isPresent(cached)) return { value: cached as never, source: 'enrichment_cache' };
          }
          const live = await blitzDeptDistribution(li);
          return live ? { value: live, source: 'tool:blitz.dept_distribution.http' } : null;
        })(),
      );
    }
    return memo.get(li)!;
  };
}

export interface RelatedOutcome {
  related: RelatedCompany[];
  basis: FinderResult['basis'];
  trace: string[];
}

export async function relatedForProspect(args: {
  prospect: { name: string; domain: string; about?: string | null };
  perCompany: { key: string; fallback?: unknown }[];
  clientId: string | null | undefined;
  play: Record<string, unknown> | null | undefined;
}): Promise<RelatedOutcome> {
  const dnc = await loadDnc(args.clientId);
  const found = await findRelated(args.prospect, { dnc, dept: deptLookup(), play: args.play });
  if (!dnc.size) found.trace.push('client do-not-contact list: empty or unavailable');

  const rows: ManifestRow[] = args.perCompany
    .filter((e) => e.key !== DEPT)
    .map((e) => ({ key: e.key, source: 'generation_time', required: false, fallback: e.fallback }));

  const related = await Promise.all(
    found.companies.map(async (x): Promise<RelatedCompany> => {
      const inputs: Record<string, unknown> = { [DEPT]: x.dept.value };
      let unavailable: string[] = [];
      if (rows.length) {
        try {
          const res = await resolveManifest(rows, {
            lead: { enrichments_used: {}, email: null, company_id: await companyIdOf(x.linkedin_url!), person_id: null },
            company: {
              company_name: x.name,
              primary_domain: x.domain,
              industry: x.industry,
              employees_on_linkedin: x.employees_on_linkedin,
              about: x.about,
              specialties: x.specialties,
              website: x.website,
              linkedin_url: x.linkedin_url,
              hq_country: x.hq?.country_name,
            },
            person: null,
            playConstants: {},
          });
          Object.assign(inputs, res.values);
          unavailable = res.unavailable.map((u) => u.key);
        } catch {
          unavailable = rows.map((r) => r.key);
        }
      }
      return {
        name: x.name,
        domain: x.domain ?? null,
        linkedin_url: x.linkedin_url ?? null,
        industry: x.industry ?? null,
        employee_count: x.employees_on_linkedin ?? null,
        hq_country: x.hq?.country_name ?? null,
        found_by: x.found_by,
        like: x.like ?? null,
        inputs,
        unavailable_inputs: unavailable,
      };
    }),
  );
  return { related, basis: found.basis, trace: found.trace };
}
