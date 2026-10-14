// Runs the runtime's frozen qa_prompt over one produced deliverable (ruling 45). The prompt is
// applied as written; this file adds only the hard rules every magnet carries anyway.
import { structured, S } from '../llm.js';

export interface QaVerdict {
  pass: boolean;
  score: number;
  notes: string;
  issues: string[];
}

const SCHEMA = S.obj({ pass: S.bool, score: S.int, notes: S.str, issues: S.arr(S.str) });

const SYSTEM = `You are the final QA gate for ONE lead magnet produced for ONE prospect, run before the link is sent.
Apply the frozen QA prompt you are given exactly as written. On top of it, always fail the deliverable if:
- anything about the prospect is invented (a number, fact or claim not in the obtained inputs),
- it names the wrong person or company, or the promise it was offered under is not kept,
- it is visibly broken (placeholders, template syntax, empty sections, garbled text).
Sections left out because an input could not be obtained are acceptable when the page is still coherent and
complete without them. Do not fail it for that alone.
Return:
- pass: your verdict.
- score: 0 to 100.
- notes: one or two plain sentences for the person drafting the reply email. Say what the deliverable shows and,
  if any inputs were missing, what was left out, so the reply does not promise it. No em dashes.
- issues: each concrete problem found (empty when it passes).`;

export interface QaInput {
  qaPrompt: string;
  promise: string[];
  prospect: { full_name: string | null; company_name: string | null };
  obtained: string[];
  omitted: { key: string; reason: string }[];
  checks: Record<string, boolean>;
  pageText: string;
}

export async function runQa(input: QaInput): Promise<QaVerdict> {
  const user = [
    '# Frozen QA prompt',
    input.qaPrompt,
    '',
    '# Promise the cold email made',
    JSON.stringify(input.promise),
    '',
    '# Prospect',
    JSON.stringify(input.prospect),
    '',
    '# Inputs obtained',
    input.obtained.join(', ') || '(none)',
    '',
    '# Inputs that could not be obtained (their sections were omitted)',
    input.omitted.length ? input.omitted.map((o) => `${o.key}: ${o.reason}`).join('\n') : '(none)',
    '',
    '# Mechanical checks already run (true = pass, cta_fallback_used true = booking link missing on the card)',
    JSON.stringify(input.checks),
    '',
    '# The deliverable (visible page text)',
    input.pageText.slice(0, 15_000),
  ].join('\n');
  const v = await structured<QaVerdict>({ system: SYSTEM, user, name: 'magnet_qa_verdict', schema: SCHEMA });
  return { ...v, score: Math.max(0, Math.min(100, v.score)) };
}
