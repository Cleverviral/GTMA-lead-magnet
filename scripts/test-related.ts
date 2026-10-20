// Live test of a related-companies magnet (rulings 63-71) through build-previews: the 5 real
// Data Magnet fixture leads, the "Hiring Signals at the Companies You Work With" recipe, and the
// service's own finders. Compare with magnet-service-tool-kit/related-companies-test/e2e-previews-report.json.
//   npm run test:related               client palette
//   npm run test:related -- --default  house default palette (no brand colours)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isFlagged } from '../src/custom/flags.js';
import type { BuildResponse } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures');
const base = (process.env.SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, '');
const args = process.argv.slice(2);

const payload = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'sample-payload-build-previews.json'), 'utf8'));
payload.lead_magnet_id = '00000000-0000-4000-8000-0000000000aa';
payload.runtime_id = 'test-hiring-signals-related';
payload.idempotency_key = crypto.randomUUID();
payload.recipe.skill_md = fs.readFileSync(path.join(fixturesDir, 'recipe-hiring-signals-related.md'), 'utf8');
payload.recipe.input_manifest = [
  { key: 'company_domain', source: 'lead_list', required: true },
  { key: 'company_name', source: 'lead_list', required: true },
  { key: 'company_case_study_customers', source: 'generation_time', required: false },
  { key: 'company_target_market', source: 'generation_time', required: false },
  { key: 'company_dept_distribution', source: 'generation_time', required: false },
];
payload.magnet.name = 'Hiring Signals at the Companies You Work With';
payload.magnet.promise = ['A map of hiring at three companies you work with, and the signals your team could track there.'];
payload.magnet.description = 'Team-by-team headcount at three companies that matter to the prospect, and the one team to watch at each.';
payload.magnet.hosted_base_url = null;
payload.client.client_id = 'd420c1e6-ef6d-446a-aa10-6feeee877684'; // Data Magnet: for its do-not-contact list
if (args.includes('--default')) payload.client.brand_colors = { default: true };
for (const f of payload.fixtures) f.inputs = {};
const n = Number(args[args.indexOf('--fixtures') + 1]) || payload.fixtures.length;
payload.fixtures = payload.fixtures.slice(0, n);

console.log(`POST ${base}/magnet/build-previews  related-companies magnet, ${payload.fixtures.length} real leads${args.includes('--default') ? ', house default palette' : ''}`);
const t0 = Date.now();
const res = await fetch(`${base}/magnet/build-previews`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_API_KEY}` },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(300_000),
});
const body = (await res.json()) as BuildResponse;
console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
if (!res.ok) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}
const names = Object.fromEntries(payload.fixtures.map((f: { person_id: string; full_name: string; company: { company_name: string } }) => [f.person_id, `${f.full_name} @ ${f.company.company_name}`]));
for (const r of body.results) {
  const flagged = Object.entries(r.checks).filter(([k, v]) => isFlagged(k, v)).map(([k]) => k);
  const total = Object.keys(r.checks).length;
  console.log(`${r.status === 'produced' ? 'OK  ' : 'FAIL'} ${names[r.person_id]}   ${(r.latency_ms / 1000).toFixed(1)}s   checks ${total - flagged.length}/${total}${flagged.length ? '  flagged: ' + flagged.join(', ') : ''}`);
  if (r.related) console.log(`     ${r.related.basis}: ${r.related.companies.map((c) => `${c.name} (${c.found_by}${c.like ? ' of ' + c.like : ''})`).join(', ')}`);
  console.log(`     url: ${r.url ?? '-'}`);
  if (r.failure_reason) console.log(`     failure: ${r.failure_reason}`);
  for (const note of r.notes ?? []) console.log(`     · ${note}`);
}
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'related-results.json'), JSON.stringify(body, null, 2));
