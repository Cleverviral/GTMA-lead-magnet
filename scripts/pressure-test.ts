// Pressure test for /magnet/produce-for-reply: real leads from the one real play, run
// sequentially (clean baseline) then concurrently (does the service hold up under load).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, '');
const CAMPAIGN = '107';
// Real sequencer_lead_ids from play_lead_lists for this campaign (pulled earlier from the test branch).
const LEAD_IDS = ['103424', '103425', '103426', '103427', '103428', '103429', '103430', '103431', '103432', '103433', '103434', '103435', '103436', '103437', '103438'];

interface Outcome { lead: string; status: string; ms: number; attempts?: number; omitted?: string[]; failure?: string | null }

async function callOne(leadId: string, label: string): Promise<Outcome> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/magnet/produce-for-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_API_KEY}` },
      body: JSON.stringify({ sequencer: 'email_bison', sequencer_campaign_id: CAMPAIGN, sequencer_lead_id: leadId }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json()) as { status: string; attempts?: number; omitted_inputs?: string[]; failure_reason?: string | null };
    const ms = Date.now() - t0;
    console.log(`  [${label}] lead ${leadId}: ${body.status} in ${(ms / 1000).toFixed(1)}s (attempts ${body.attempts ?? '-'})${body.failure_reason ? ` — ${body.failure_reason}` : ''}`);
    return { lead: leadId, status: body.status, ms, attempts: body.attempts, omitted: body.omitted_inputs, failure: body.failure_reason ?? null };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`  [${label}] lead ${leadId}: THREW in ${(ms / 1000).toFixed(1)}s — ${e instanceof Error ? e.message : String(e)}`);
    return { lead: leadId, status: 'threw', ms, failure: e instanceof Error ? e.message : String(e) };
  }
}

function summarize(label: string, outcomes: Outcome[]) {
  const produced = outcomes.filter((o) => o.status === 'produced').length;
  const avg = outcomes.reduce((s, o) => s + o.ms, 0) / outcomes.length / 1000;
  const max = Math.max(...outcomes.map((o) => o.ms)) / 1000;
  const retried = outcomes.filter((o) => (o.attempts ?? 1) > 1).length;
  console.log(`\n${label}: ${produced}/${outcomes.length} produced, avg ${avg.toFixed(1)}s, max ${max.toFixed(1)}s, ${retried} needed a retry`);
}

console.log(`=== SEQUENTIAL: ${LEAD_IDS.length} real leads, one at a time ===`);
const sequential: Outcome[] = [];
for (const id of LEAD_IDS) sequential.push(await callOne(id, 'seq'));
summarize('SEQUENTIAL', sequential);

console.log(`\n=== CONCURRENT: same ${LEAD_IDS.length} leads, all fired at once ===`);
const t0 = Date.now();
const concurrent = await Promise.all(LEAD_IDS.map((id) => callOne(id, 'con')));
const wallClock = (Date.now() - t0) / 1000;
summarize('CONCURRENT', concurrent);
console.log(`wall clock for the whole concurrent batch: ${wallClock.toFixed(1)}s (vs ${(sequential.reduce((s, o) => s + o.ms, 0) / 1000).toFixed(1)}s sequential total)`);

console.log('\n=== REPEAT: same leads again, should all come back cached/instant ===');
const t1 = Date.now();
const repeat = await Promise.all(LEAD_IDS.map((id) => callOne(id, 'rep')));
console.log(`repeat batch wall clock: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'pressure-test-results.json'), JSON.stringify({ sequential, concurrent, repeat }, null, 1));
