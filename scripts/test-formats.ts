// Pressure test: every buildable magnet FORMAT against real company data, via build-previews
// (doesn't need the play's magnet pointer, so it works for formats the one real play isn't
// wired to). Reports pass/fail, checks and timing per fixture per format.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures');
const base = (process.env.SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, '');

const companies: {
  company_id: string; company_name: string; primary_domain: string; industry: string;
  employees_on_linkedin: number; hq_city: string | null; hq_country: string | null; about: string; full_name: string; person_id: string;
}[] = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'diverse-companies.json'), 'utf8'));

const CLIENT = {
  client_name: 'Data Magnet', website: 'https://www.datamagnet.co/',
  brand_colors: { accent: '#16a34a', accent2: '#22c55e', ink: '#111827', mut: '#64748b', line: '#e2e8f0', bg: '#f8fafc' },
  logo_url: null, booking_url: 'https://cal.com/datamagnet/15min', booking_poc_name: 'Mayank',
};

interface FormatDef { name: string; magnetId: string; recipeFile: string; manifest: { key: string; source: string; required: boolean }[]; promise: string[]; description: string }

const FORMATS: FormatDef[] = [
  {
    name: 'LinkedIn Data Freshness Risk Snapshot',
    magnetId: '1a1ae237-88a5-4bed-855c-c36e3756f84e',
    recipeFile: 'test-runtime-recipe-freshness.md',
    manifest: [
      { key: 'company_name', source: 'lead_list', required: true },
      { key: 'company_domain', source: 'lead_list', required: true },
      { key: 'company_industry', source: 'lead_list', required: true },
      { key: 'company_website', source: 'generation_time', required: false },
      { key: 'company_about', source: 'generation_time', required: false },
      { key: 'company_specialties', source: 'generation_time', required: false },
      { key: 'company_research_notes', source: 'generation_time', required: false },
    ],
    promise: ['A 1-page snapshot of where stale LinkedIn/company data is likely hurting your workflows.'],
    description: "A one-page diagnostic showing where stale LinkedIn or company data is likely hurting the prospect's workflows.",
  },
  {
    name: 'Data API Fit Report',
    magnetId: '2d147a63-72a8-47e7-8699-9e4b2330894b',
    recipeFile: 'test-runtime-recipe-fit-report.md',
    manifest: [
      { key: 'company_name', source: 'lead_list', required: true },
      { key: 'company_domain', source: 'lead_list', required: true },
      { key: 'company_industry', source: 'lead_list', required: true },
      { key: 'company_website', source: 'generation_time', required: false },
      { key: 'company_about', source: 'generation_time', required: false },
      { key: 'company_specialties', source: 'generation_time', required: false },
      { key: 'company_research_notes', source: 'generation_time', required: false },
      { key: 'person_job_title', source: 'generation_time', required: false },
      { key: 'person_headline', source: 'generation_time', required: false },
    ],
    promise: ['A short report showing which real-time data feeds would be most useful for your product or GTM motion.'],
    description: "A short recommendation report identifying which real-time B2B/LinkedIn/intent data feeds fit the prospect's workflow.",
  },
];

interface Row { format: string; lead: string; status: string; url: string | null; passed: number; total: number; flagged: string[]; latency_ms: number; failure: string | null }
const results: Row[] = [];

for (const fmt of FORMATS) {
  const skill_md = fs.readFileSync(path.join(fixturesDir, fmt.recipeFile), 'utf8');
  const payload = {
    lead_magnet_id: fmt.magnetId,
    runtime_id: `test-${fmt.magnetId}`, runtime_version: 1,
    gtm_play_id: null,
    idempotency_key: crypto.randomUUID(),
    recipe: { skill_md, play_constants: {}, input_manifest: fmt.manifest, output_contract: { deliverable: 'html_link', pre_send_checks: ['url_resolves', 'no_placeholders'], expected_turnaround_minutes: 10 } },
    magnet: { kind: 'custom', name: fmt.name, promise: fmt.promise, description: fmt.description, hosting: 'ours', hosted_base_url: null, integration: null },
    client: CLIENT,
    proofpoints: [],
    fixtures: companies.map((c) => ({
      person_id: c.person_id, lead_list_id: c.company_id, reply_id: null,
      first_name: c.full_name.split(' ')[0], full_name: c.full_name,
      company: { company_name: c.company_name, primary_domain: c.primary_domain, industry: c.industry, employee_count: c.employees_on_linkedin, hq_city: c.hq_city, hq_country: c.hq_country, about: c.about },
      inputs: {},
    })),
  };
  console.log(`\n=== ${fmt.name} (${companies.length} real companies) ===`);
  const t0 = Date.now();
  const res = await fetch(`${base}/magnet/build-previews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_API_KEY}` }, body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { results?: { person_id: string; status: string; url: string | null; checks: Record<string, boolean>; latency_ms: number; failure_reason: string | null }[] };
  console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!res.ok || !body.results) { console.log(JSON.stringify(body, null, 2)); continue; }
  for (const r of body.results) {
    const lead = companies.find((c) => c.person_id === r.person_id)!;
    const flagged = Object.entries(r.checks).filter(([k, v]) => (k === 'cta_fallback_used' ? v : v === false)).map(([k]) => k);
    const total = Object.keys(r.checks).length;
    console.log(`  ${r.status === 'produced' ? 'OK  ' : 'FAIL'} ${lead.full_name} @ ${lead.company_name} (${lead.employees_on_linkedin} emp)  ${(r.latency_ms / 1000).toFixed(1)}s  ${total - flagged.length}/${total}${flagged.length ? '  flagged: ' + flagged.join(',') : ''}`);
    if (r.failure_reason) console.log(`       failure: ${r.failure_reason}`);
    results.push({ format: fmt.name, lead: `${lead.full_name} @ ${lead.company_name}`, status: r.status, url: r.url, passed: total - flagged.length, total, flagged, latency_ms: r.latency_ms, failure: r.failure_reason });
  }
}

const outDir = path.join(here, '..', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'format-test-results.json'), JSON.stringify(results, null, 1));
const n = results.length, produced = results.filter((r) => r.status === 'produced').length;
const avgChecks = results.length ? (results.reduce((s, r) => s + r.passed / r.total, 0) / results.length * 100).toFixed(0) : '0';
const avgLatency = results.length ? (results.reduce((s, r) => s + r.latency_ms, 0) / results.length / 1000).toFixed(1) : '0';
console.log(`\n=== TOTAL: ${produced}/${n} produced, avg ${avgChecks}% checks passed, avg ${avgLatency}s/page ===`);
