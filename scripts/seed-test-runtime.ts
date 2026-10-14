// TEST ONLY. Stands in for GTMA's approval freeze so the reply-time path can run on the test
// branch: inserts an approved lead_magnet_runtimes row for every buildable Data Magnet custom
// magnet (the standard_asset one needs no runtime and is skipped). `--undo` removes every seed
// this script made and this service's test productions. Never run against a production database.
//
//   npm run seed:runtime            seed all three (no-op per magnet if already approved)
//   npm run seed:runtime -- --undo  remove them again
import '../src/net.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const SUB_PROFILE_ID = 'b3b3aaeb-7fc8-4e94-87b7-e5bb26f5a5ab'; // Data Magnet · Default
const SEED_BY = 'TEST SEED (magnet_service)';
// Ruling 43: sanctioned TEST card values (GTMA/magnet-test/card-test-values.json + the reference build's palette).
const TEST_CARD = {
  booking_url: 'https://cal.com/datamagnet/15min',
  booking_poc_name: 'Mayank',
  brand_colors: { accent: '#16a34a', accent2: '#22c55e', ink: '#111827', mut: '#64748b', line: '#e2e8f0', bg: '#f8fafc' },
};
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.GTMA_DATABASE_URL!, { max: 1, onnotice: () => {} });

const OUTPUT_CONTRACT = { deliverable: 'html_link', pre_send_checks: ['url_resolves', 'no_placeholders'], expected_turnaround_minutes: 10 };
const FAILURE_POLICY = { retries: 2, on_fail: 'hold_and_retry' };

interface Seed {
  magnetId: string;
  recipeFile: string;
  manifest: { key: string; source: string; required: boolean }[];
  qaPrompt: string;
}

const SEEDS: Seed[] = [
  {
    magnetId: 'b410812e-2ed8-429e-8396-6ccfded59c79', // Hiring & Headcount Signal Map
    recipeFile: 'test-runtime-recipe.md',
    manifest: [
      { key: 'company_name', source: 'lead_list', required: true },
      { key: 'company_domain', source: 'lead_list', required: true },
      { key: 'company_industry', source: 'lead_list', required: true },
      { key: 'company_employee_count', source: 'lead_list', required: true },
      { key: 'company_linkedin_url', source: 'lead_list', required: true },
      { key: 'company_dept_distribution', source: 'generation_time', required: false },
      { key: 'company_country_distribution', source: 'generation_time', required: false },
      { key: 'company_about', source: 'generation_time', required: false },
      { key: 'company_funding_rounds', source: 'generation_time', required: false },
      { key: 'company_tech_stack', source: 'generation_time', required: false },
    ],
    qaPrompt:
      'Does the map keep the promise (people-growth signals the prospect could track), name the right company and person, ' +
      'show only real numbers traceable to obtained inputs, carry the client brand + double book-a-call CTA + carousel, ' +
      'no em dashes, and render complete despite any omitted sections?',
  },
  {
    magnetId: '1a1ae237-88a5-4bed-855c-c36e3756f84e', // LinkedIn Data Freshness Risk Snapshot
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
    qaPrompt:
      'Does the snapshot keep the promise (where stale LinkedIn/company data is likely hurting the prospect), name the right ' +
      'company, trace every claim to an obtained input, carry the client brand + double book-a-call CTA + carousel, no em ' +
      'dashes, and render complete despite any omitted sections?',
  },
  {
    magnetId: '2d147a63-72a8-47e7-8699-9e4b2330894b', // Data API Fit Report
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
    qaPrompt:
      'Does the report keep the promise (which real-time data feeds would be most useful for this prospect), name the right ' +
      'company, recommend feeds whose reasoning traces to an obtained input, carry the client brand + double book-a-call ' +
      'CTA + carousel, no em dashes, and render complete despite any omitted sections (including the role fields, which are ' +
      'commonly unobtainable)?',
  },
];

if (process.argv.includes('--undo')) {
  for (const s of SEEDS) {
    const prods = await sql`delete from magnet_productions where lead_magnet_id = ${s.magnetId} and generator_version like 'magnet_service@%' returning production_id`;
    const rts = await sql`delete from lead_magnet_runtimes where lead_magnet_id = ${s.magnetId} and approved_by = ${SEED_BY} returning version`;
    await sql`update lead_magnets set runtime_status = 'none', current_runtime_version = null
               where lead_magnet_id = ${s.magnetId} and current_runtime_version is not null
                 and not exists (select 1 from lead_magnet_runtimes where lead_magnet_id = ${s.magnetId} and status = 'approved')`;
    console.log(`${s.magnetId}: removed ${rts.length} seeded runtime(s), ${prods.length} test production(s)`);
  }
  const card = await sql`update client_sub_profiles set booking_url = null, booking_poc_name = null, brand_colors = null
                          where sub_profile_id = ${SUB_PROFILE_ID} and booking_url = ${TEST_CARD.booking_url}
                            and booking_poc_name = ${TEST_CARD.booking_poc_name} returning sub_profile_id`;
  console.log(card.length ? 'removed the TEST card values' : 'no card values to remove');
} else {
  for (const s of SEEDS) {
    const [existing] = await sql`select version, approved_by from lead_magnet_runtimes where lead_magnet_id = ${s.magnetId} and status = 'approved'`;
    if (existing) {
      console.log(`${s.magnetId}: an approved runtime already exists (v${existing.version}, approved by ${existing.approved_by}); nothing seeded`);
      continue;
    }
    const [row] = await sql<{ next: number }[]>`select coalesce(max(version), 0) + 1 as next from lead_magnet_runtimes where lead_magnet_id = ${s.magnetId}`;
    const next = row!.next;
    const skillMd = fs.readFileSync(path.join(here, '..', 'fixtures', s.recipeFile), 'utf8');
    await sql.begin(async (tx) => {
      await tx`
        insert into lead_magnet_runtimes
          (lead_magnet_id, version, skill_md, input_manifest, play_constants, output_contract, failure_policy,
           qa_prompt, status, test_report, built_with_skill, approved_by, approved_at)
        values
          (${s.magnetId}, ${next}, ${skillMd}, ${tx.json(s.manifest)}, ${tx.json({})},
           ${tx.json(OUTPUT_CONTRACT)}, ${tx.json(FAILURE_POLICY)}, ${s.qaPrompt}, 'approved',
           ${tx.json({ note: 'TEST SEED: stands in for the window approval so the reply path can be exercised' })},
           'build-custom-lead-magnet', ${SEED_BY}, now())`;
      await tx`update lead_magnets set runtime_status = 'approved', current_runtime_version = ${next} where lead_magnet_id = ${s.magnetId}`;
    });
    console.log(`${s.magnetId}: seeded approved runtime v${next}`);
  }
  const card = await sql`update client_sub_profiles
                            set booking_url = ${TEST_CARD.booking_url}, booking_poc_name = ${TEST_CARD.booking_poc_name},
                                brand_colors = ${sql.json(TEST_CARD.brand_colors)}
                          where sub_profile_id = ${SUB_PROFILE_ID} and booking_url is null and booking_poc_name is null and brand_colors is null
                          returning sub_profile_id`;
  console.log(card.length ? 'filled the empty Data Magnet card with TEST booking link, POC and brand colours' : 'card already has values; left untouched');
}
await sql.end();
