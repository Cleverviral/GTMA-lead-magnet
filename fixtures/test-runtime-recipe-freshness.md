# RUNTIME SKILL — LinkedIn Data Freshness Risk Snapshot (DataMagnet) · TEST SEED (not a real approval)
magnet: 1a1ae237-88a5-4bed-855c-c36e3756f84e · kind: custom · built_with: build-custom-lead-magnet

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
play_constants: none

## Production steps
1. Header: "A data freshness check for <company>", sub naming DataMagnet.
2. Facts row: industry, website (if obtained).
3. "What <company> publishes about itself": 2-3 sentences from company_about and company_specialties, only if obtained.
4. "Where stale data usually hides" (from company_research_notes when obtained, else general but still
   evidence-anchored to the facts that WERE obtained): a short list of the specific risk areas a live-refreshed
   profile API protects against for a company at this employee count and industry (e.g. title changes,
   org moves, new hires not yet reflected). Every claim must trace to an obtained input; no invented numbers.
5. Carousel fallback claims when no proofpoints are approved (source: datamagnet.co): "Real-time, not cached" ·
   "75+ fields per profile" · "Trusted by data-driven teams" (same three as the other DataMagnet recipes).
6. Closing CTA: invite a 15 minute call with the booking contact to see a live refresh on their own CRM data.

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no_placeholders · expected_turnaround_minutes: 10

## Failure policy
retries: 2 · on_fail: hold_and_retry (ruling 46)
