# RUNTIME SKILL — Hiring & Headcount Signal Map (DataMagnet) · v1 DRAFT
magnet: b410812e-2ed8-429e-8396-6ccfded59c79 · kind: custom · built_with: build-custom-lead-magnet
play tested against: 15081b51-ece2-4be0-862c-ecf054c93ba1 (B2B Data Providers Headcount Signal Map)

## Input manifest
| key | source | required | fallback |
|---|---|---|---|
| company_domain | lead_list (companies.primary_domain) | yes | — |
| company_name | lead_list (companies.company_name) | yes | — |
| company_industry | lead_list (companies.industry) | yes | — |
| company_employee_count | lead_list (companies.employees_on_linkedin) | yes | — |
| company_dept_distribution | enrichment (enrichments_used, Blitz dept route) | yes | — |
| company_country_distribution | enrichment (enrichments_used, Blitz country route) | yes | — |
| person_full_name | lead_list (person_index.full_name) | yes | — |
play_constants: none

## Production steps
1. Brand pull: GET https://www.<company_domain> (browser UA; retry bare domain). Tokens: <title>,
   meta theme-color, else most frequent saturated mid-lightness hex in page + first same-site
   stylesheet (min 2 occurrences). No confident colour -> fallback accent #1f4d3a + flag
   brand_low_confidence (production proceeds; noted in log).
2. Render the page from the fixed template (header "Prepared for <first> at <company> ... by
   DataMagnet"; facts row; dept bars top 8; country bars top 6 with ISO->name map, 'unknown'
   rows dropped; signals block; DataMagnet CTA; footer).
3. Signals (deterministic, from the real distributions, each dept used at most once):
   largest dept = net-adds signal; next tech dept (Eng/IT/R&D) = build-out signal; Sales&BD
   (count >= 3) = GTM-velocity signal; 2nd known country (count >= 3) = new-country signal;
   always close with the freshness signal. Counts phrased with person/people.
4. Host at <hosted_base_url>/<token> (hosting: ours).

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no unfilled placeholders, prospect +
client named, no 'unknown' text, no duplicate signal departments · expected_turnaround_minutes: 10

## Failure policy
retries: 2 · on_fail: hold_and_retry (ruling 46: a failed production is flagged + parked; the reply WAITS, never sent magnetless)

## Known limits (from the 5-fixture test, 2026-10-06)
- Sub-100-employee orgs produce thin signals (IPVM scored 82) — prefer plays that slice
  min headcount, or ship the small-team wording variant before using it there.
- Brand extraction fails soft on palette-less sites (Worldly) — fallback accent + flag.
