// Plays the autoresponder's part: sends ONLY a lead reference to /magnet/produce-for-reply.
//
//   npm run reply                                  the live-test lead: email_bison · 107 · 103430
//   npm run reply -- --campaign 107 --lead 103430  any other lead reference
//   npm run reply -- --key abc                     pass an idempotency key
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const body = {
  sequencer: opt('--sequencer') ?? 'email_bison',
  sequencer_campaign_id: opt('--campaign') ?? '107',
  sequencer_lead_id: opt('--lead') ?? '103430',
  ...(opt('--key') ? { idempotency_key: opt('--key') } : {}),
};

const base = (process.env.SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, '');
console.log(`POST ${base}/magnet/produce-for-reply  ${JSON.stringify(body)}`);
const t0 = Date.now();
const res = await fetch(`${base}/magnet/produce-for-reply`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_API_KEY}` },
  body: JSON.stringify(body),
});
const out = await res.json();
console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(JSON.stringify(out, null, 2));

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'out', 'last-reply.json'), JSON.stringify(out, null, 2));
