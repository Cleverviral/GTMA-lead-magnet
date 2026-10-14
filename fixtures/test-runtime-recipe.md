# RUNTIME SKILL — Hiring & Headcount Signal Map (DataMagnet) · TEST SEED (not a real approval)
magnet: b410812e-2ed8-429e-8396-6ccfded59c79 · kind: custom · built_with: build-custom-lead-magnet
play: 15081b51-ece2-4be0-862c-ecf054c93ba1 (B2B Data Providers Headcount Signal Map)

## Input manifest
| key | source | required | fallback |
|---|---|---|---|
| company_name | lead_list | yes | — |
| company_domain | lead_list | yes | — |
| company_industry | lead_list | yes | — |
| company_employee_count | lead_list | yes | — |
| company_linkedin_url | lead_list | yes | — |
| company_dept_distribution | generation_time | no | — |
| company_country_distribution | generation_time | no | — |
| company_about | generation_time | no | — |
| company_funding_rounds | generation_time | no | — |
| company_tech_stack | generation_time | no | — |
play_constants: none

## Production steps
1. Header: "Prepared for <first name> at <company>", with a one-line sub naming DataMagnet and live LinkedIn headcount data.
2. Facts row: people on LinkedIn (company_employee_count), industry, headquarters.
3. "Where the people are, by department": bars for the top 8 departments of company_dept_distribution (count and percentage).
4. "Where the people are, by country": bars for the top 6 known countries of company_country_distribution, country codes spelled out, "unknown" dropped.
5. "What <company> does": two or three sentences drawn only from company_about.
6. "Funding signals": only if company_funding_rounds was obtained.
7. "Tech stack signals": only if company_tech_stack was obtained.
8. "Signals <company> could track" (deterministic, from the real distributions, each department used at most once):
   largest department = net-adds signal; next tech department (Engineering, IT, R&D) = build-out signal; Sales and BD
   (count >= 3) = go-to-market velocity signal; second known country (count >= 3) = new-country signal; always close
   with the freshness signal. Counts phrased with person/people.
9. Carousel fallback claims when no proofpoints are approved (source: datamagnet.co):
   "Real-time, not cached: profiles are fetched live at request time." · "75+ fields per profile: structured JSON on
   people and companies, headcount and department splits included." · "Trusted by data-driven teams: data providers,
   GTM and recruiting teams run refresh and trigger workflows on DataMagnet."
10. Closing CTA: invite a 15 minute call with the booking contact to wire these signals into their refresh or trigger workflow.

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no_placeholders · expected_turnaround_minutes: 10

## Failure policy
retries: 2 · on_fail: hold_and_retry (ruling 46)
