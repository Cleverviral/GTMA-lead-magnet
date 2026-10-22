# Design a custom lead magnet page (service-side execution skill)

Input: the build payload — `recipe.skill_md` (this magnet's structure, logic, templates),
`client` (booking_url, name, website; no colours, no logo, no booking contact name),
`proofpoints`, one `fixture` (person + company facts + resolved `inputs`), `magnet`
(promise, hosting, hosted_base_url).
Output: one hosted HTML page per fixture + mechanical check results.

## The always-rules (apply to EVERY page, recipe cannot override)
This file is the single home of the page design rules; every skill and doc points here.
1. **Palette = the PROSPECT's brand colours** (ruling 89): run `fetch_brand_colors.py` on
   `fixture.company.primary_domain` (theme colour → logo colour → brand CSS variable → most
   used CSS colour; builder presets never count; a real colour, readable with white text).
   Nothing passes → the ember-orange default below. Cache per domain for 30 days, like logos.
   **Never the client's logo** on the page (ruling 90); the client is named only in the footer.
2. **Prospect logo** via fetch_logo.py against `fixture.company.primary_domain`: own
   app icon → Google favicon → quality gate (≥96px, square-ish, real, not blank/default).
   **No pass = no logo** — hide the tile; the layout must look complete without it. Show in
   the 56px rounded white tile, 7px padding when the icon has transparency.
3. **CTA twice**: top-right button in a sticky bar + a closing CTA block, href
   `booking_url`. The closing CTA is about the next step of value (going further with what
   the page shows), button text "Book a call with us" (ruling 100). The booking contact's
   name is never on the page. Missing `booking_url` → use `client.website` and set
   `checks.cta_fallback_used = true` (GTMA flags it; never invent a link).
4. **Case-study carousel** directly above the closing CTA, below the transparency block (ruling 102): approved `proofpoints` → the
   client's own resources and assets (API docs, guides, tools) → omit the strip and set
   `carousel_present=false` (flagged). No source label line under it. Never filler derived
   from the magnet's own description (rulings 57, 57a).
5. **No em dashes anywhere.** Country/industry codes spelled out. person/people grammar.
6. **Every number and claim traces to a payload value** — nothing about the prospect is
   ever invented. A missing required ON-LIST input (manifest source `lead_list`) fails the
   build for that fixture; that is the only hard fail. A value that can't be fetched at build
   time (e.g. a `generation_time` key with no result) → reshape or omit that section (the
   layout stays complete) and record the missing input in the QA notes (ruling 50); a missing
   optional input uses its manifest fallback.
7. Phone-width clean (no horizontal scroll), bars drawn to scale, `unknown` rows dropped.
8. **Footer**, exactly one line, centred and bold: "Prepared by <client> · <client site> for
   <first name>, <company>." (rulings 55, 90, 100)

## Whose data (ruling 63a)
Read from the recipe's input list (no stored field): no finder keys = render the prospect's
own data; finder keys present = 3 companies that matter to the prospect. Finder order and
exclusions: `finders/README.md` (ruling 68a). The page frames them as
"companies you work with / sell to".

## Numbers
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

## Layout and copy rules
- No source label line under the resources carousel.
- Never claim movement from a snapshot: team sizes are a one-time picture, so no "hiring is
  moving", "growing" or "trend" unless the data has two points in time.
- Plain words over jargon ("new hires", not "net adds").
- Department labels sit on one line on desktop (label column wide enough).
- Resource cards: a grid that fits the row; never a strip cut off at the right edge.
- Phone width: the sticky bar stays one line (hide the kicker, trim a long company name,
  smaller logo tile and button) so it never eats the screen.
- Headcount on its own line; the "shares are of N profiles with a known team" note under it,
  smaller.

## Transparency block (rulings 65b, 100 — always present)
A highlighted note (accent-coloured top border, info icon), placed just ABOVE the carousel
(order, ruling 102: transparency block → carousel → closing CTA → footer), in the client's
voice, text centred and bold. Copy, no em dashes:
"This is auto-generated and reviewed by our team. Happy to dive deeper on our introduction
call."  (exactly this, nothing more)

## Page-content bans (rulings 55-57 — hard checks)
- ZERO internal vocabulary on the page: no "Source: client card / recipe / magnet
  description / supplied data", no provenance tails, no recipe terms as headings.
- Footer: the one centred, bold line of rule 8; nothing else.
- Never assume anyone's gender: CTA and body copy say "we", never he/she.
- ONE magnet = ONE skeleton: render the recipe's fixed sections in its fixed order; vary
  values only. Never improvise structure per lead.
- Carousel: rule 4 (proofpoints → the client's own resources/assets → omit and flag).
- Every page has a palette: the prospect's pulled colours, or the default below when the pull
  fails. Never an unstyled grey page.
  DEFAULT palette, EMBER ORANGE (operator, ruling 54b): accent #ea580c · accent2 #f97316 ·
  tag background #fff7ed · ink #111827 · muted #64748b · line #e2e8f0 · bg #f8fafc.

## Mechanics
Render `recipe.skill_md`'s structure with the payload values → host at
`{hosted_base_url}/{company-slug}-{short code}` (ruling 88: company name, legal suffix dropped,
plus a random code; ours = our randomized domain, or the client subdomain when
`hosting='client_domain'`)
→ run `output_contract.pre_send_checks` + the rule checks above → return
`{person_id, status, url, checks, latency_ms, failure_reason}`.
Pages carry `noindex`. The random code makes links unguessable; the hosted page's address uses the full slug, never the domain alone.
Reference implementation: `magnet-test/finders/e2e_related.py` + `magnet-test/finders/previews-related/`
(25 checks, 2026-10-22).
