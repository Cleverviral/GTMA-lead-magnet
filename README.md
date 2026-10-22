# Lead Magnet Service (the generator)

Two touch points, per `../magnet-service-tool-kit/docs/LEAD-MAGNET-SYSTEM.md` and the contract
(`../magnet-service-tool-kit/docs/magnet-service-contract.md`, kit v5 2026-10-22):

1. **Generate previews:** GTMA pushes the draft recipe and 5 preview people (custom) or companies
   (external). The service fetches the generation_time values itself the same way as at reply time
   (ruling 94), builds and hosts 5 pages (or calls the client's tool 5 times), and returns links +
   check results. GTMA keeps them in the recipe's `test_report`; previews are never run-log rows.
2. **Reply time:** the autoresponder sends only a lead reference. The service reads GTMA's
   database, resolves every input (paying for a vendor call only when nothing free has it), builds,
   runs the frozen QA prompt, logs its own `magnet_productions` row, and returns the link + QA notes.

Craft rules every page obeys live in `skills/`. The service's own storage is the `magnet_service`
schema (hosted pages, idempotency records, the 30-day logo cache), created on boot. In GTMA's
database it writes exactly one table: `magnet_productions` (ruling 52).

`src/net.ts` raises Node's per-address connect window from 250ms to 2s. Node 20+ abandons each IP
after 250ms, shorter than the ~300ms round trip from the dev machine to Neon's us-east-2, so without
it DB connections fail with `ETIMEDOUT` whenever latency creeps over 250ms.

## Run

TypeScript throughout (`src/`, `scripts/`, `test/`). `dev`/`test`/`sample`/`reply` run the `.ts`
sources via `tsx`; `npm start` compiles to `dist/` first (what Render does).

```
npm install
npm run dev            # http://localhost:8080
npm test               # unit tests, no network or LLM
npm run typecheck
npm run sample         # previews: the 5 real Data Magnet leads in fixtures/, like GTMA would send
npm run test:related   # previews of a related-companies magnet on the same 5 leads (finders run live)
npm run test:formats   # two other Data Magnet formats on 6 different real companies
npm run test:other-client   # SocialHP: real case studies, no booking link
npm run seed:runtime   # TEST BRANCH ONLY: stand-in for GTMA's approval (runtime + TEST card values)
npm run reply -- --reply <id>   # reply time: email_bison · 107 · 103430 (WRITES a magnet_productions row)
npm run seed:runtime -- --undo   # remove the test runtime, TEST card values and test productions
```

`npm run sample` flags: `--fixtures 2` · `--produce` · `--key <k>` · `--no-booking` · `--missing-input` ·
`--external` ("Connect your own lead magnet" against the stand-in tool; start it first with `npm run mock:tool`) ·
`--external --bad-key` (key refused: the test call stops the set) · `--external --async` (job-id API: stops) ·
`--external --oauth` (unsupported login: nothing is called).
`npm run reply` flags: `--reply <id>` · `--campaign <id>` · `--lead <id>` · `--sequencer <name>` · `--key <k>`.
`npm run test:related` flags: `--fixtures 2`.
Set `SERVICE_URL` to hit a deployed instance instead of localhost.

## Endpoints

All `POST` routes need `Authorization: Bearer $SERVICE_API_KEY`.

| Route | Who calls it | What |
|---|---|---|
| `POST /magnet/build-previews` | GTMA | full payload, 1 to 10 fixtures (GTMA sends 5) |
| `POST /magnet/produce` | autoresponder | `{sequencer, campaign_id, lead_id, reply_id}` (+ optional `idempotency_key`); a full 1-fixture payload is still accepted |
| `POST /magnet/produce-for-reply` | autoresponder | same as `/magnet/produce` with a lead reference (older name) |
| `GET /{company-slug}-{code}` | the prospect | the hosted page, e.g. `/datassential-wfrzvp` (`noindex`, no scripts); older 22-character links still work |
| `GET /health` | Render | DB ping |

### Reply-time response

```json
{ "status": "produced", "link": "https://…/datassential-wfrzvp", "qa_notes": "…", "production_id": "…",
  "lead_magnet_id": "…", "omitted_inputs": ["company_funding_rounds"], "failure_reason": null, "attempts": 1 }
```

| `status` | HTTP | Meaning for the autoresponder |
|---|---|---|
| `produced` | 200 | send the reply with `link`; `qa_notes` says what the page shows and what was left out |
| `failed` | 200 | no link: flagged + parked, the reply WAITS (ruling 46); `failure_reason` says why |
| `no_magnet` | 200 | the play offers no magnet: draft normally |
| `standard_asset` | 200 | fixed asset, nothing to produce |
| `held` | 409 | no `reply_id` / an unknown one (nothing built), or the play is live without an approved runtime (gate bypass, logged as a failed run): hold for a human |
| `not_found` / `ambiguous` | 404 / 409 | the lead reference matches no / several play lead list rows |

Inputs come from, in order: the lead row's `enrichments_used`, the `companies`/`people` fact columns,
the shared `company_enrichments`/`person_enrichments` cache, then (generation_time keys only) the
route's tool through `data_keys` → `route_keys` → `route_tools` → `data_tools`, using the env var
`credential_ref` points at (`BLITZ_API_KEY` or `ENV:NE_API_KEY` style). Callable tools today: the
Blitz HTTP endpoints, and `web.homepage_research.native` (fetches the homepage, writes
`company_research_notes` with the model). Other tools report "not callable by the generator yet" and
their section is omitted. External magnets: the key is read from the secret store through
`client_integrations.credential_ref` (today the env var it names); once the client tool has
answered 2xx the run is never called again, even if checks or QA fail afterwards (one call can
create a real item). A key nothing can supply is left out of the page, never invented. A
required `lead_list` key that is missing fails the run (the go-live gate was bypassed). Build + QA
retry up to `failure_policy.retries` (default 2); every run is logged, pass or fail, as a
`positive_reply` row with `runtime_version` (once the v4 column exists). `reply_id` is required:
the database refuses a reply run without one and linking runs to replies is on hold (ruling 105),
so the service holds the call rather than guess. A repeat call for the same reply returns the same link.

## The page (kit v5)

Every custom page has the same frame around the magnet's own sections, in this order: top bar and
CTA → header → the magnet's sections → **What <prospect> could do with this** (2-3 actions, each
naming the team that buys what the prospect sells, never a catch-all like "Other") → transparency
note ("This is auto-generated and reviewed by our team. Happy to dive deeper on our introduction
call.", centred and bold) → carousel → closing CTA ("Book a call with us", never a person's name)
→ one-line footer, centred and bold ("Prepared by <client> · <site> for <first name>, <company>.").
No client logo, no source lines, no internal words on the page.

- **Colours (ruling 89):** the PROSPECT's own brand colour, pulled from its site (`src/brand.ts`, a
  port of `skills/fetch_brand_colors.py`): theme colour → logo colour → brand CSS variable → most
  used CSS colour, through a quality gate. Nothing passes → ember orange, flagged
  `default_palette_used`. Cached in memory per domain (no extra database table).
- **Links (ruling 88):** the company name plus a short random code, e.g. `/datassential-wfrzvp`, on
  the shared neutral domain (`PUBLIC_BASE_URL`) or the client's verified subdomain.
- **Carousel:** approved case studies (`proofpoints`) first; else the client's own `resources`
  (title, description, url; GTMA reads them from `assets`); else omitted.
- **Numbers:** written 1,234; every share states its base; no trend claims from one snapshot; no
  gendered pronouns.

### Related-companies magnets (rulings 63-71)

A magnet whose `input_manifest` contains `company_case_study_customers` or `company_target_market`
shows data about three companies that matter to the prospect, never the prospect's own. Finders
run in this order (`src/related/`):
1. **Case-study customers** on the prospect's own site, matched to Blitz by exact name (press logos excluded).
2. **Lookalikes** of any brand found: same industry and country, closest in size.
3. **Target market**, only when no brand was found: an LLM maps who the prospect says it serves to a
   Blitz company search (allowed industries only), largest companies first.

A company is used only when at least 20% of its LinkedIn people list a team, and never if it is on
the client's do-not-contact list. Every card says how it was found ("From your case studies",
"Similar to <brand>", "In your market"). The other `company_*` keys in the manifest are resolved
per related company. GTMA may send its own picks as `fixture.related_companies`; then the finders
are skipped. At preview time this path reads GTMA's database read-only (play summary, the magnet
owner's do-not-contact list, the enrichment cache) and degrades gracefully if it can't.

### Payload fields (beyond the contract's core)

| Field | What |
|---|---|
| `fixtures[].person_id` + `company_id` | preview identity (no `lead_list_id`); external previews may send companies only |
| `play` | `{name, summary, offer, reply_guidance}`; looked up from `gtm_play_id` if absent |
| `client.client_id` | the client's id, for its do-not-contact list (else read from the magnet's owner) |
| `resources` | `[{title, description?, url, kind?}]`; when absent and there are no proofpoints, read from the client's `assets` |
| `fixtures[].related_companies` | GTMA-chosen related companies (`name, domain, linkedin_url, found_by, like, inputs`) |
| `magnet.integration` + `recipe.output_contract` | external: `{base_url, auth_kind, credential, endpoint_path}` + `{method, header, link_field, request_mapping}` |

Client colours and logo are no longer read (rulings 89-90); the booking contact's name is never on the page.

## Checks (custom pages)

`inputs_present · no_placeholders · prospect_named · client_named · prospect_brand_colors ·
no_client_logo · logo_gate_respected · no_em_dashes · cta_top_and_bottom ·
cta_about_next_step_not_a_person · carousel_present · transparency_block · bottom_order ·
closing_centred_bold · so_what_section · action_names_a_buyer_team · one_line_footer ·
no_internal_vocab · no_gendered_pronoun · no_trend_overclaim · shares_base_stated ·
consistent_thousands · no_unknown_text · codes_spelled_out · numbers_traceable · noindex`, plus on
related-companies magnets `three_related_companies · prospect_not_a_subject · honest_source_label ·
every_related_company_shown`. All pass-when-true except the two flags `cta_fallback_used` (booking
link missing on the card) and `default_palette_used` (no prospect colour passed: ember orange).

External calls: `call_succeeded · link_field_present · link_opens · right_company_named ·
same_answer_under_60s`. Logins: API key header, bearer token, username and password; anything else
stops before any call. The first call of a preview set is the test call: a refused key, a job id,
text or no link there skips the rest.

## Deploy (Render)

`render.yaml` blueprint. Secrets to set: `DATABASE_URL` (service's own schema), `GTMA_DATABASE_URL`
(GTMA's database), `SERVICE_API_KEY`, `OPENAI_API_KEY`, `BLITZ_API_KEY`. `RENDER_EXTERNAL_URL` is
used for page links unless `PUBLIC_BASE_URL` is set. The process must start with cwd `magnet_service/`
since `skills/` is read at runtime.
