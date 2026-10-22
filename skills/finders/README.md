# The two finders (rulings 63a, 67a, 68a) — run by the generator when a magnet's inputs list the finder keys

Goal: three companies that matter to the prospect, never the prospect itself. Order
(ruling 68a): case-study customers → lookalikes of any brand found → target market only when
no brand is found at all.

## Finder 1: company_case_study_customers (first)
1. Read the prospect's homepage; follow links to customers / case studies / customer stories.
2. Collect named customers: case-study page addresses (/case-studies/barilla/,
   /resource/caseys-case-study/), story headlines ("How Lovesac built..."), logo alt text.
   Drop generic labels ("Top 200 Burger Chain") and site furniture (icon names).
3. Resolve each name to a company record with an EXACT name match (Blitz search by
   keyword, accept only a normalised exact name; a fuzzy hit is dropped, never guessed).
4. Keep the 3 largest by LinkedIn headcount.
Code: finder_case_study_customers.py (the production version adds one LLM pass to clean
names, because many sites load their logos with JavaScript).

## Finder 2a: LOOKALIKES of any brand found (ruling 68a — before target market)
If finder 1 found at least one brand, fill the remaining slots with companies LIKE that
brand: same industry and country, closest in size. (Worldly: Lovesac → Patagonia, REI.)

## Finder 2b: company_target_market (only when NO brand at all is found)
1. Read who the prospect says they serve (their meta description and homepage copy).
2. Turn it into a company search (industry + keywords + country). In production an LLM
   does this mapping; keep the evidence quote with the result.
3. Take the largest companies, excluding the prospect.

## Selection rules
- Used only if at least 20% of its LinkedIn people list a known team (ruling 69); else skip
  and take the next one.
- Fewer than 3 from finder 1 → lookalikes of the found brands top up the rest (rulings 68/68a).
- Exclude the client's DO-NOT-CONTACT list (ruling 67a). Competitors are NOT separately
  detected or skipped.
- Press logos ('as featured in' BBC, NYT, WSJ...) are never customers (ruling 71).

## Then, for each of the 3 companies
Department distribution, cheapest first: the shared enrichment cache in Postgres, then a
Blitz call. Show team shares AGAINST the profiles with a known team (state the base), and
format every number the same way.

## Tested 2026-10-20 (magnet-test/finders/e2e_related.py)
Datassential → finder 1: General Mills, Gallo, Griffith Foods (Brinker skipped, 5% coverage) (from their own case
studies). Worldly → finder 1 found Lovesac, lookalikes added Patagonia, REI.
DataStax, IPVM, Millennium → finder 2. 5 previews + 1 reply-time run: 25/25 checks each (brand and ember-orange default palettes).
Finding: real named customers were genuinely absent for 3 of 5 prospects (DataStax pages
redirect to IBM; Millennium anonymises clients; IPVM shows only press logos).
