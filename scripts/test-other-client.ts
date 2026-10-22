// Tests a DIFFERENT real client (SocialHP, not Data Magnet): real approved proofpoints (first
// time exercising that code path instead of the fallback-claims branch), a real but currently
// empty brand card (independent proof the CTA/palette fallback works for a second client, not
// just Data Magnet with its card artificially cleared), and a magnet GTMA itself has flagged as
// unable to deliver its own headline promise as specified. Prospects are borrowed from Data
// Magnet's real TAM (SocialHP has none of its own on this test branch) — real company data,
// just not SocialHP's own list.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isFlagged } from '../src/custom/flags.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures');
const base = (process.env.SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, '');

const companies: { company_id: string; company_name: string; primary_domain: string; industry: string; employees_on_linkedin: number; hq_city: string | null; hq_country: string | null; about: string; full_name: string; person_id: string }[] = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'diverse-companies.json'), 'utf8'),
);

// SocialHP's REAL client card, as it actually stands on the test branch: real offer, real
// approved proofpoints, no brand colours / booking link set yet.
const CLIENT = {
  client_name: 'SocialHP',
  website: 'https://www.socialhp.com/',
  booking_url: null,
};
const PROOFPOINTS = [
  { kind: 'brand_name', statement: 'Turbonomic' },
  { kind: 'case_study', statement: 'Turbonomic reached 84% employee advocacy adoption, cut major costs versus its prior tool, and drove more shares in one week than in the prior year.' },
  { kind: 'metric', statement: 'SocialHP has a 4.9 rating on G2.' },
  { kind: 'metric', statement: 'SocialHP reports a 99% all-time renewal rate.' },
];

const manifest = [
  { key: 'company_name', source: 'lead_list', required: true },
  { key: 'company_domain', source: 'lead_list', required: true },
  { key: 'company_website', source: 'lead_list', required: false },
  { key: 'company_linkedin_url', source: 'lead_list', required: true },
  { key: 'company_employee_count', source: 'lead_list', required: true },
];
const skill_md = fs.readFileSync(path.join(fixturesDir, 'test-runtime-recipe-dormant-reach.md'), 'utf8');

const payload = {
  lead_magnet_id: 'a0100842-fc51-42f2-83d5-ccadc208fed4',
  runtime_id: 'test-dormant-reach', runtime_version: 1,
  gtm_play_id: null,
  idempotency_key: crypto.randomUUID(),
  recipe: { skill_md, play_constants: {}, input_manifest: manifest, output_contract: { deliverable: 'html_link', pre_send_checks: ['url_resolves', 'no_placeholders'], expected_turnaround_minutes: 15 } },
  magnet: {
    kind: 'custom', name: 'Dormant Reach Audit',
    promise: ["A one-page Dormant Reach Audit showing the prospect's untapped employee-reach multiplier."],
    description: "A one-page company-specific estimate contrasting the prospect's LinkedIn company-page audience with the combined first-degree network of their employees, surfacing the untapped employee-reach multiplier as their own number.",
    hosting: 'ours', hosted_base_url: null, integration: null,
  },
  client: CLIENT,
  proofpoints: PROOFPOINTS,
  fixtures: companies.map((c) => ({
    person_id: c.person_id, company_id: c.company_id,
    first_name: c.full_name.split(' ')[0], full_name: c.full_name,
    company: { company_name: c.company_name, primary_domain: c.primary_domain, industry: c.industry, employee_count: c.employees_on_linkedin, hq_city: c.hq_city, hq_country: c.hq_country, about: c.about },
    inputs: { company_website: `https://${c.primary_domain}`, company_linkedin_url: `https://www.linkedin.com/company/${c.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
  })),
};

console.log(`=== SocialHP · Dormant Reach Audit · ${companies.length} real (borrowed) companies ===`);
console.log('booking_url: (none, real current state)  proofpoints: 4 real approved rows  colours: each prospect\'s own\n');
const t0 = Date.now();
const res = await fetch(`${base}/magnet/build-previews`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_API_KEY}` }, body: JSON.stringify(payload),
});
const body = (await res.json()) as { results?: { person_id: string; status: string; url: string | null; checks: Record<string, boolean>; latency_ms: number; failure_reason: string | null; notes: string[] }[] };
console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!res.ok || !body.results) { console.log(JSON.stringify(body, null, 2)); process.exit(1); }
for (const r of body.results) {
  const lead = companies.find((c) => c.person_id === r.person_id)!;
  const flagged = Object.entries(r.checks).filter(([k, v]) => isFlagged(k, v)).map(([k]) => k);
  const total = Object.keys(r.checks).length;
  console.log(`${r.status === 'produced' ? 'OK  ' : 'FAIL'} ${lead.full_name} @ ${lead.company_name}`);
  console.log(`     url: ${r.url ?? '-'}   ${(r.latency_ms / 1000).toFixed(1)}s   checks ${total - flagged.length}/${total}${flagged.length ? '  flagged: ' + flagged.join(',') : ''}`);
  if (r.failure_reason) console.log(`     failure: ${r.failure_reason}`);
  for (const n of r.notes ?? []) console.log(`     note: ${n}`);
}
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'other-client-results.json'), JSON.stringify(body, null, 1));
