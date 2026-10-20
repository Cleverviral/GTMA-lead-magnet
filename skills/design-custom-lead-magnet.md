# Design a custom lead magnet page (service-side execution skill)

Input: the build payload — `recipe.skill_md` (this magnet's structure, logic, templates),
`client` (brand_colors, logo_url, booking_url, booking_poc_name, name, website),
`proofpoints`, one `fixture` (person + company facts + resolved `inputs`), `magnet`
(promise, hosting, hosted_base_url).
Output: one hosted HTML page per fixture + mechanical check results.

## The always-rules (rulings 38–45 — apply to EVERY page, recipe cannot override)
1. **Palette = the CLIENT's `brand_colors`** (payload values; never derive your own, never
   the prospect's colours).
2. **Prospect logo** via fetch_logo.py against `fixture.company.primary_domain`: own
   app icon → Google favicon → quality gate (≥96px, square-ish, real, not blank/default).
   **No pass = no logo** — hide the tile; the layout must look complete without it. Show in
   the 56px rounded white tile, 7px padding when the icon has transparency.
3. **CTA twice**: top-right button in a sticky bar + a closing CTA block — text
   "Book a call" / "Book a call with {booking_poc_name}", href `booking_url`. Missing
   booking values → use `client.website` and set `checks.cta_fallback_used = true`
   (GTMA flags it; never invent a link or a name).
4. **Case-study carousel** directly above the closing CTA, from `proofpoints` per the
   recipe's selection rule; empty → the recipe's labeled fallback claims.
5. **No em dashes anywhere.** Country/industry codes spelled out. person/people grammar.
6. **Every number and claim traces to a payload value** — nothing about the prospect is
   ever invented; a missing optional input uses its manifest fallback, a missing required
   input fails the build for that fixture.
7. Phone-width clean (no horizontal scroll), bars drawn to scale, `unknown` rows dropped.
8. Page footer: prepared-by line naming the client and the prospect.

## Whose data (rulings 63-64)
Read from the recipe's input list (no stored field): no finder keys = render the prospect's own data;
finder keys present = the payload carries the FOUND companies (case-study customers,
else target market) with their values; the page frames them as "companies you work with /
sell to". Never competitors.

## Numbers (learned 2026-10-20)
Percentages always state their base: "team shares below are of the N profiles with a known
team". Never put a team share under a different headcount. Format every number the same
way (1,234), in bars and in sentences.

## "What <prospect> could do with this" — REQUIRED section (ruling 70)
The data alone is not the magnet; the page must say what the prospect can DO with it. Carry
the play's angle and the magnet description into 2-3 concrete actions tied to what the
prospect sells (e.g. time outreach when a buyer team grows; spot expansion before it is
announced; prioritise accounts). Each action names a REAL team from the data, and it must
be the team that BUYS what the prospect sells, never a catch-all ("General Business &
Management", "Other").

## Layout and copy rules (design audit 2026-10-20)
- No source label line under the resources ("From datamagnet.co" removed).
- Never claim movement from a snapshot: team sizes are a one-time picture, so no "hiring is
  moving", "growing" or "trend" unless the data has two points in time.
- Plain words over jargon ("new hires", not "net adds").
- Department labels sit on one line on desktop (label column wide enough).
- Resource cards: a grid that fits the row; never a strip cut off at the right edge.
- Phone width: the sticky bar stays one line (hide the kicker, trim a long company name,
  smaller logo tile and button) so it never eats the screen.
- Headcount on its own line; the "shares are of N profiles with a known team" note under it,
  smaller.

## Transparency block (ruling 65 — always present)
A highlighted note (accent-coloured left border, info icon), placed just above the closing
CTA, in the client's voice. Copy, no em dashes:
"This is auto-generated and reviewed by our team. Happy to dive deeper on our introduction
call."  (exactly this, nothing more)

## Page-content bans (rulings 55-57 — hard checks)
- ZERO internal vocabulary on the page: no "Source: client card / recipe / magnet
  description / supplied data", no provenance tails, no recipe terms as headings.
- Footer, exactly one line: "Prepared by <client> · <client site> for <first name>, <company>."
- Never assume anyone's gender: CTA and body copy use the booking contact's NAME or "we",
  never he/she.
- ONE magnet = ONE skeleton: render the recipe's fixed sections in its fixed order; vary
  values only. Never improvise structure per lead.
- Carousel: payload proofpoints → payload client assets/resources (source-labeled) → omit
  and flag carousel_present=false. Never filler derived from the magnet's own description.
- The payload ALWAYS carries a palette: the client's stored brand colours, or the HOUSE
  DEFAULT below when the operator chose "no brand colours in mind" (ruling 54a). Never an
  unstyled grey page.
  HOUSE DEFAULT palette, EMBER ORANGE (operator, ruling 54b): accent #ea580c · accent2 #f97316 ·
  tag background #fff7ed · ink #111827 · muted #64748b · line #e2e8f0 · bg #f8fafc.

## Mechanics
Render `recipe.skill_md`'s structure with the payload values → host at
`{hosted_base_url}/{token}` (ours, or the client subdomain when `hosting='client_domain'`)
→ run `output_contract.pre_send_checks` + the rule checks above → return
`{person_id, status, url, checks, latency_ms, failure_reason}`.
Pages carry `noindex`. Tokens are unguessable; files named by token, never by domain.
Reference implementation: the Data Magnet validation pages (magnet-test/previews/) and
build_custom_test.py — 12 checks, 5/5 green on real leads, 2026-10-06.
