// Executes recipe.skill_md for ONE fixture: the model writes the page CONTENT as typed blocks.
// The HTML shell (palette, logo tile, CTAs, related-company labels, carousel, transparency block,
// footer) is rendered by code in render.ts, so the always-rules never depend on the model.
import { loadSkill, structured, S, type JsonSchema } from '../llm.js';
import { deepMapStrings, isUnknownLabel, noDashes, spellCode } from '../text.js';
import type { Payload, Fixture, ResolvedInputs, PageContent, ContentBlock } from '../types.js';

const block = (type: string, props: Record<string, JsonSchema>) => S.obj({ type: S.enm(type), ...props });
const barItem = S.obj({ label: S.str, value: S.num, display: S.str });

const BLOCKS: JsonSchema[] = [
  block('section', { heading: S.str, intro: S.nstr }),
  block('paragraph', { text: S.str }),
  block('stats', { items: S.arr(S.obj({ value: S.str, label: S.str })) }),
  block('bars', { heading: S.nstr, base: S.nstr, scale: S.enm('percent', 'relative'), items: S.arr(barItem) }),
  block('company', { index: S.int, base: S.nstr, items: S.arr(barItem), note: S.str }),
  block('cards', { items: S.arr(S.obj({ title: S.str, body: S.str })) }),
  block('list', { style: S.enm('bullet', 'check', 'number'), items: S.arr(S.str) }),
  block('table', { columns: S.arr(S.str), rows: S.arr(S.arr(S.str)) }),
  block('score', { label: S.str, value: S.num, max: S.num, verdict: S.str }),
  block('callout', { text: S.str }),
];

const SCHEMA = S.obj({
  missing_required_inputs: S.arr(S.str),
  page_title: S.str,
  topbar_label: S.str,
  headline: S.str,
  subheadline: S.str,
  blocks: S.arr({ anyOf: BLOCKS }),
  actions: S.arr(S.obj({ title: S.str, body: S.str, team: S.str })),
  proof_heading: S.str,
  proofpoint_indexes: S.arr(S.int),
  closing_heading: S.str,
  closing_body: S.str,
});

const SYSTEM = `You are the content engine of the Lead Magnet render service.
You execute ONE magnet recipe (recipe.skill_md) for ONE prospect and return the page CONTENT as JSON.
The service renders that content inside a fixed design shell. The shell already provides, and you must NOT write:
the palette, the prospect logo tile, the sticky top bar with the "Book a call" button, the heading of the
"What <prospect> could do with this" section, the carousel cards, the transparency note, the closing "Book a call"
button, the footer line, and each related company's name, "how we found it" label and LinkedIn headcount.

How to treat the recipe:
- Follow its structure, logic, wording and selection rules for the page body.
- ONE magnet = ONE skeleton: use the recipe's sections in the recipe's order, with the same section headings for every
  prospect. Only the values change from one prospect to the next. Never add, drop or rename a section per prospect,
  except to omit one whose input could not be obtained.
- Skip recipe steps the service performs itself: brand or colour pulls, logo fetching, finding related companies,
  hosting, URL tokens, pre-send checks.
- The craft rules below win over the recipe whenever they conflict.

Content rules (hard):
1. Every number and every claim about a company must come from the provided data. You may round a value
   (38.63 to 38.6 or 39) but never compute, estimate or invent new figures, dates, rankings or facts.
2. If a REQUIRED input is missing or empty, list its key in missing_required_inputs and keep everything else minimal.
3. Never use em dashes or en dashes. Use commas, colons or the word "to".
4. Spell out every country code, industry code and abbreviation from the data (US becomes United States).
5. Always drop "unknown" rows silently. Never mention that rows were dropped, filtered or are unknown, and never use the
   word "unknown": present the clean data with no narration of how it was cleaned.
6. Grammar: 1 person, 2 people. Address the prospect by first name where the recipe does.
7. Never assume anyone's gender: refer to the booking contact by name or say "we", never he, she, his or her.
   Never invent a link, name, title or URL.
8. No placeholders, no template syntax, no markdown, no HTML. Plain text in every string.
9. Format every number the same way, with thousands separators (1,234), in bars, tiles and sentences alike.
10. A percentage always says what it is a share of. When bars show shares, set "base" to one short line naming the base,
    e.g. "Team shares below are of the 2,181 profiles with a known team." Never put a share under a different total.
11. The data is a one-time snapshot: never claim movement ("growing", "shrinking", "is moving", "trend") unless the data
    holds two points in time. Use plain words ("new hires", not "net adds").
12. Zero internal vocabulary on the page: never write "client card", "recipe", "magnet description", "data source",
    "supplied", "generated from" or anything about where the data came from.

Blocks you can use (pick what the recipe's structure needs, in page order):
- section {heading, intro}: starts a titled section.
- paragraph {text}
- stats {items:[{value,label}]}: a row of fact tiles.
- bars {heading, base, scale, items:[{label,value,display}]}: a bar chart. scale "percent" means value is 0 to 100 and is
  the bar width; "relative" means bars are drawn against the largest value. display is the right-hand text,
  e.g. "107 (38.63%)". base: what the shares are of (rule 10), or null when the bars are not shares.
- company {index, base, items:[{label,value,display}], note}: ONE related company's card. index points into the related
  companies list given below. items are that company's bars (shares, scale percent), base is rule 10's line for them,
  note is one sentence on the signal to watch there. Use one company block per related company, in the list's order.
- cards {items:[{title,body}]}: signal, insight or recommendation cards.
- list {style,items}
- table {columns,rows}
- score {label,value,max,verdict}
- callout {text}

Related companies (only when a list is given below):
- The page shows THEIR data for the prospect, never the prospect's own data in their place, and never a competitor.
- Frame them as their label says: case-study customers are "companies you work with", lookalikes are "companies like
  your customers", target-market companies are "companies in your market". Do not mix these up.

"What <prospect> could do with this" (actions, REQUIRED):
- 2 or 3 actions, each a short title and one or two sentences, tied to what the prospect sells (read it from the
  prospect's company description and the play) and to the data on this page.
- team: the exact name of ONE real team from the data shown on the page that BUYS what the prospect sells. Never a
  catch-all ("General Business & Management", "Other"). The action's body must name that team.

Carousel (sits above the transparency note and the closing CTA):
- If proofpoints are provided, put the indexes of those to show in proofpoint_indexes, per the recipe's selection rule
  (empty array means show all of them). proof_heading is its heading (e.g. "Why teams pick <client>").
- If there are no proofpoints, the shell shows the client's own resources or nothing; leave proofpoint_indexes empty.

Fields:
- page_title: the browser tab title. topbar_label: a short label shown above the prospect's company name in the top
  bar (e.g. "<Client> · hiring signals for"). headline / subheadline: the page header.
- closing_heading / closing_body: the closing CTA block copy, inviting a call with the booking contact.

=== CRAFT RULES (service skill bundle) ===
${loadSkill('design-custom-lead-magnet.md')}`;

function userMessage({ payload, fixture, resolved }: { payload: Payload; fixture: Fixture; resolved: ResolvedInputs }): string {
  const { recipe, magnet, client, proofpoints, play } = payload;
  const related = fixture.related_companies ?? [];
  return [
    '# Recipe (recipe.skill_md)',
    recipe.skill_md,
    '',
    '# Play constants',
    JSON.stringify(recipe.play_constants ?? {}),
    '',
    '# The GTM play this magnet serves',
    play ? JSON.stringify(play) : '(not given)',
    '',
    '# Magnet',
    JSON.stringify({ name: magnet.name ?? null, promise: magnet.promise, description: magnet.description }),
    '',
    '# Client (the page is prepared BY this client)',
    JSON.stringify({ client_name: client.client_name, website: client.website, booking_poc_name: client.booking_poc_name ?? null }),
    '',
    '# Approved proofpoints (index: statement)',
    proofpoints.length ? proofpoints.map((p, i) => `${i}: [${p.kind ?? 'proof'}] ${p.statement}`).join('\n') : '(none)',
    '',
    '# Prospect',
    JSON.stringify({ first_name: fixture.first_name, full_name: fixture.full_name, company: fixture.company }),
    '',
    '# Resolved inputs (manifest key: value)',
    JSON.stringify(resolved.values),
    resolved.usedFallback.length ? `Fallback values used for: ${resolved.usedFallback.join(', ')}` : '',
    '',
    '# Inputs that could not be obtained',
    fixture.unavailable_inputs.length
      ? `${fixture.unavailable_inputs.join(', ')}. Omit the recipe sections that need them, or reshape them around the data that IS present. Never fill them with guesses, and never mention on the page that anything is missing.`
      : '(none)',
    '',
    '# All raw inputs on the fixture',
    JSON.stringify(fixture.inputs ?? {}),
    '',
    '# Related companies (index: company, found by, its data)',
    related.length
      ? related
          .map((rc, i) =>
            `${i}: ${JSON.stringify({
              name: rc.name,
              found_by: rc.found_by,
              like: rc.like ?? null,
              industry: rc.industry ?? null,
              employees_on_linkedin: rc.employee_count ?? null,
              hq_country: rc.hq_country ?? null,
              inputs: rc.inputs,
              unavailable_inputs: rc.unavailable_inputs,
            })}`,
          )
          .join('\n')
      : '(none: this magnet shows the prospect\'s own data)',
  ].join('\n');
}

const cleanItems = <T extends { label: string; value: number }>(items: T[]): T[] =>
  items.filter((i) => !isUnknownLabel(i.label) && Number.isFinite(i.value)).map((i) => ({ ...i, label: spellCode(i.label) }));

function clean(content: PageContent): PageContent {
  const c = deepMapStrings(content, noDashes);
  c.blocks = c.blocks
    .map((b: ContentBlock): ContentBlock => {
      if (b.type === 'bars' || b.type === 'company') return { ...b, items: cleanItems(b.items) };
      if (b.type === 'table') {
        return { ...b, rows: b.rows.filter((r) => !isUnknownLabel(r[0])).map((r) => r.map(spellCode)) };
      }
      if (b.type === 'stats') return { ...b, items: b.items.filter((i) => !isUnknownLabel(i.value)) };
      return b;
    })
    .filter((b): boolean => {
      if (b.type !== 'company' && 'items' in b && Array.isArray(b.items) && b.items.length === 0) return false;
      if (b.type === 'table' && b.rows.length === 0) return false;
      return true;
    });
  c.actions = c.actions.filter((a) => a.title.trim() && a.body.trim()).slice(0, 3);
  return c;
}

export async function writeContent({ payload, fixture, resolved }: { payload: Payload; fixture: Fixture; resolved: ResolvedInputs }): Promise<PageContent> {
  const raw = await structured<PageContent>({
    system: SYSTEM,
    user: userMessage({ payload, fixture, resolved }),
    name: 'magnet_page_content',
    schema: SCHEMA,
  });
  return clean(raw);
}
