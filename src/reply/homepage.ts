// web.homepage_research.native: fetch the company's homepage and distill company_research_notes
// ("what the company does, who it sells to and notable signals, read from its homepage").
import { getPublic } from '../logo.js';
import { structured, S } from '../llm.js';
import { noDashes, visibleText } from '../text.js';

const SYSTEM = `You write research notes about ONE company from the visible text of its own homepage.
3 to 5 short plain sentences: what the company does, who it sells to, and any notable signals the page itself states
(launches, customer names, scale claims, hiring, regions). Use ONLY facts present in the text; never infer or invent.
No em dashes or en dashes. If the text has no usable description of the company, set found to false and notes to "".`;

const SCHEMA = S.obj({ found: S.bool, notes: S.str });

export type HomepageOutcome = { ok: true; value: string } | { ok: false; reason: string };

export async function homepageResearch(inputs: Record<string, unknown>): Promise<HomepageOutcome> {
  const website = typeof inputs.company_website === 'string' ? inputs.company_website : null;
  const domain = typeof inputs.company_domain === 'string' ? inputs.company_domain : null;
  const url = website ?? (domain ? `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/` : null);
  if (!url) return { ok: false, reason: 'homepage_research needs company_website or company_domain' };

  let text: string;
  try {
    const res = await getPublic(url, 3_000_000);
    if (res.status !== 200) return { ok: false, reason: `homepage returned HTTP ${res.status}` };
    text = visibleText(res.data.toString('utf8')).slice(0, 20_000);
  } catch (e) {
    return { ok: false, reason: `homepage fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (text.length < 200) return { ok: false, reason: 'homepage has too little readable text (likely rendered by script)' };

  const out = await structured<{ found: boolean; notes: string }>({
    system: SYSTEM,
    user: `# Homepage URL\n${url}\n\n# Visible homepage text\n${text}`,
    name: 'homepage_research_notes',
    schema: SCHEMA,
  });
  const notes = noDashes(out.notes.trim());
  return out.found && notes ? { ok: true, value: notes } : { ok: false, reason: 'homepage text had no usable description of the company' };
}
