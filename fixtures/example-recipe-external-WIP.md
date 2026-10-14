# RUNTIME SKILL DRAFT — NewsEngine Draft-PR Magnet (external) · v1 · status: WORK IN PROGRESS (key connected 2026-10-06; live 5-fixture run pending operator go)
magnet_kind: external · integration: NewsEngine (Sizzle Newswire) · built_with: build-external-lead-magnet
Integration (Settings row, test): base_url https://feeds.newsengine.io · auth_kind api_key
(header x-ne-key) · credential_ref ENV:NE_API_KEY (never stored in any table or this file)

## Input manifest
| key | source | required | note |
|---|---|---|---|
| topic | rendered per lead | yes | template: "<company_name>, a <company_industry> company, expands its <top dept from company_dept_distribution> team to meet demand" — every slot from real lead data |
| title_choice | play_constant | no | default 1; append ?titleId=N to the returned url, N in 1..3 |

## Production steps
1. POST /stories/marketing/draft, header x-ne-key from ENV, body {"topic": <rendered topic>}.
2. Parse storyId, titles (exactly 3), url. NEVER construct the url manually (vendor rule).
3. Deliverable = url + '?titleId=' + title_choice.
4. Pre-send checks: HTTP 200 · storyId present · 3 titles · url present and resolves ·
   latency noted (vendor says <3s; probe measured 2.6s to the auth layer).
5. Status sync: GET /stories/marketing/release/status/<storyId> — progression
   VIEWED_PR_PAGE → CREATED_ACCOUNT → STARTED_PR_FLOW → PURCHASED_PR. Feed send-sync/replies;
   alert on PURCHASED_PR. (Pre-view status + poll interval undocumented: confirm live.)

## Failure policy (vendor doc)
400 fix body · 401/403 stop, key problem, surface to operator · 408/5xx retry backoff max 3 ·
one draft per POST, no update endpoint, so NO blind retries after a 200.

## Test state 2026-10-06
Probe (LM-1 sanctioned): endpoint + header shape CONFIRMED (missing header -> 400 naming
x-ne-key); key REJECTED (403 Unauthorized on both endpoints, key length 36). Key now connected per the operator. The 5-fixture loop is staged in
magnet-test/run_external_test.py and runs the moment the key authenticates.
