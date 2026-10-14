# RUNTIME SKILL — Data API Fit Report (DataMagnet) · TEST SEED (not a real approval)
magnet: 2d147a63-72a8-47e7-8699-9e4b2330894b · kind: custom · built_with: build-custom-lead-magnet

## Input manifest
| key | source | required | fallback |
|---|---|---|---|
| company_name | lead_list | yes | — |
| company_domain | lead_list | yes | — |
| company_industry | lead_list | yes | — |
| company_website | generation_time | no | — |
| company_about | generation_time | no | — |
| company_specialties | generation_time | no | — |
| company_research_notes | generation_time | no | — |
| person_job_title | generation_time | no | — |
| person_headline | generation_time | no | — |
play_constants: none

## Production steps
1. Header: "A data feed fit report for <first name> at <company>", sub naming DataMagnet.
2. Facts row: industry, website (if obtained).
3. "What we know about <company>": 2-3 sentences from company_about / company_specialties / company_research_notes,
   whichever were obtained; if person_job_title or person_headline were obtained, fold the prospect's role in
   naturally ("as <role> at <company>..."); if neither was obtained, address the prospect generically, no guess
   at their role.
4. "Recommended feeds": 2-4 cards, each a real-time B2B/LinkedIn/intent data feed category (company profile
   refresh, people/role-change signals, intent/technographic signals, funding/hiring signals), each card's
   reasoning tied explicitly to an obtained fact (industry, specialties, or research notes). No card may reference
   a fact that was not obtained.
5. Carousel fallback claims when no proofpoints are approved (source: datamagnet.co): "Real-time, not cached" ·
   "75+ fields per profile" · "Trusted by data-driven teams".
6. Closing CTA: invite a 15 minute call with the booking contact to scope which feeds fit their stack.

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no_placeholders · expected_turnaround_minutes: 10

## Failure policy
retries: 2 · on_fail: hold_and_retry (ruling 46)
