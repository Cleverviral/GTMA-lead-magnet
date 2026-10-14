// Pressure test the LIVE vendor-call path specifically: 10 real companies with no cached
// department distribution anywhere, resolved concurrently, so every one is a genuine fresh
// Blitz HTTP call fired at once (not the free-path leads the main pressure test covers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveManifest } from '../src/reply/inputs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const companies: { company_id: string; company_name: string; linkedin_url: string }[] = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'fixtures', 'fresh-companies.json'), 'utf8'),
);

const manifest = [
  { key: 'company_linkedin_url', source: 'lead_list' as const, required: true },
  { key: 'company_dept_distribution', source: 'generation_time' as const, required: false },
  { key: 'company_country_distribution', source: 'generation_time' as const, required: false },
];

console.log(`=== ${companies.length} real companies, zero cached, all fired at once (live Blitz calls) ===`);
const t0 = Date.now();
const results = await Promise.all(
  companies.map(async (c) => {
    const ct0 = Date.now();
    const lead = { enrichments_used: {}, company_id: c.company_id, person_id: '00000000-0000-0000-0000-000000000000', email: null } as never;
    try {
      const r = await resolveManifest(manifest, { lead, company: { linkedin_url: c.linkedin_url }, person: null, playConstants: {} });
      const ms = Date.now() - ct0;
      const got = Object.keys(r.values).filter((k) => k !== 'company_linkedin_url');
      console.log(`  ${c.company_name}: ${(ms / 1000).toFixed(1)}s, obtained [${got.join(', ') || 'none'}], sources ${JSON.stringify(r.sources)}`);
      return { company: c.company_name, ok: true, ms, obtained: got, unavailable: r.unavailable };
    } catch (e) {
      const ms = Date.now() - ct0;
      console.log(`  ${c.company_name}: THREW in ${(ms / 1000).toFixed(1)}s — ${e instanceof Error ? e.message : String(e)}`);
      return { company: c.company_name, ok: false, ms, error: e instanceof Error ? e.message : String(e) };
    }
  }),
);
const wallClock = (Date.now() - t0) / 1000;
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${companies.length} resolved successfully, wall clock ${wallClock.toFixed(1)}s for the whole concurrent batch`);
fs.writeFileSync(path.join(here, '..', 'out', 'pressure-vendor-results.json'), JSON.stringify(results, null, 1));
