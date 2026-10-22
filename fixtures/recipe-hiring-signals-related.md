# RUNTIME SKILL — Hiring Signals at the Companies You Work With (Data Magnet) · TEST RECIPE
kind: custom · whose data: prospect_related_companies (read from the finder keys below, ruling 63a)
Reference: magnet-service-tool-kit/related-companies-test/e2e_related.py

## Input manifest
| key | source | required | fallback |
|---|---|---|---|
| company_domain | lead_list | yes | — |
| company_name | lead_list | yes | — |
| company_case_study_customers | generation_time | no | — |
| company_target_market | generation_time | no | — |
| company_dept_distribution | generation_time | no | — |
play_constants: none

## Page (fixed skeleton, same for every prospect; only the values change)
1. Top bar label: "DataMagnet · hiring signals for".
2. Headline: "<first name>, here is how the companies you serve are staffed, and where to watch for hiring".
   Subheadline: "Team-by-team headcount at three companies, and the one team to watch at each."
3. Section heading by how the companies were found: all case-study customers → "Hiring at three companies you
   work with"; all target market → "Hiring at three companies in your market"; a mix → "Hiring at companies you
   work with, and companies like them".
4. One company card per related company, in order: its top 3 teams from company_dept_distribution as shares
   (count and percentage), base "Team shares below are of the <total_employees> profiles with a known team.",
   note "<largest team> is their largest team (<count> people, <percent>%). New hires there are the signal to watch."
5. What <company> could do with this: three actions tied to what the prospect sells (read from its own
   description): time outreach when a buyer team adds people at a company it serves; spot expansion before it is
   announced; prioritise accounts by where their teams sit. Each names the team that buys what the prospect sells.
6. Carousel: approved case studies, else Data Magnet's own resources.
7. Closing CTA: "Want these signals live, for every company you serve?" / "Grab 15 minutes with us at
   DataMagnet to set them up as a feed."

## Output contract
deliverable: html_link · pre_send_checks: url_resolves, no_placeholders · expected_turnaround_minutes: 10
