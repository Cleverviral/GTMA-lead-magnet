# RUNTIME SKILL — Dormant Reach Audit (SocialHP) · TEST SEED (not a real approval)
magnet: a0100842-fc51-42f2-83d5-ccadc208fed4 · kind: custom · built_with: build-custom-lead-magnet

> Known gap (GTMA status_reason, 2026-10-06): the magnet's own promise is an "untapped employee-reach
> multiplier" comparing the company's LinkedIn PAGE followers against its employees' combined first-degree
> network. `inputs_needed` was never given a company-page-follower-count key, so that multiplier cannot be
> computed from the declared manifest. This recipe does NOT invent that number. It shows the inputs that
> ARE real (employee count, company profile) and frames the audit as what SocialHP would calculate live on
> a call, never stating a specific multiplier as fact.

## Input manifest
| key | source | required | fallback |
|---|---|---|---|
| company_name | lead_list | yes | — |
| company_domain | lead_list | yes | — |
| company_website | lead_list | no | — |
| company_linkedin_url | lead_list | yes | — |
| company_employee_count | lead_list | yes | — |
play_constants: none

## Production steps
1. Header: "A dormant reach preview for <company>", sub naming SocialHP and employee advocacy.
2. Facts row: employee count, LinkedIn company page (as a link reference, not a follower count claim).
3. "The idea in one line": employees' combined first-degree LinkedIn networks are usually many times
   larger than a company page's own follower count, explain the employee-advocacy concept in general
   terms SocialHP uses across customers, with no SocialHP-specific number invented for this prospect.
4. "What we'd calculate on a live audit": a short, explicit list of the exact numbers a real audit
   would pull (company page followers, employee count, estimated combined network size, the multiplier)
   — framed as what happens next, never as a result already computed for this page.
5. Proofpoint carousel: use the real approved proofpoints as given (case study, G2 rating, renewal rate),
   selecting all of them.
6. Closing CTA: invite a call to run their real Dormant Reach Audit.

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no_placeholders · expected_turnaround_minutes: 15

## Failure policy
retries: 2 · on_fail: hold_and_retry (ruling 46)
