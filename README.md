# Lead Magnet Service (the generator)

Two touch points, per `../magnet_service_dev_kit/LEAD-MAGNET-SYSTEM.md` and the contract v4:

1. **Previews (build + approve):** GTMA pushes one self-contained payload; the service builds and
   hosts 5 pages and returns links + check results. No GTMA database access on this path.
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
npm run seed:runtime   # TEST BRANCH ONLY: stand-in for GTMA's approval (runtime + TEST card values)
npm run reply          # reply time: email_bison · 107 · 103430, like the autoresponder would send
npm run seed:runtime -- --undo   # remove the test runtime, TEST card values and test productions
```

`npm run sample` flags: `--fixtures 2` · `--produce` · `--key <k>` · `--no-booking` · `--missing-input` ·
`--external` (external magnet against the local mock client tool; start it first with `npm run mock:tool`) ·
`--external --bad-key` (the tool rejects the key: the first 403 stops the whole set).
`npm run reply` flags: `--campaign <id>` · `--lead <id>` · `--sequencer <name>` · `--key <k>`.
Set `SERVICE_URL` to hit a deployed instance instead of localhost.

## Endpoints

All `POST` routes need `Authorization: Bearer $SERVICE_API_KEY`.

| Route | Who calls it | What |
|---|---|---|
| `POST /magnet/build-previews` | GTMA | full payload, 1 to 10 fixtures (GTMA sends 5) |
| `POST /magnet/produce-for-reply` | autoresponder | `{sequencer, sequencer_campaign_id, sequencer_lead_id}` (+ optional `reply_id`, `idempotency_key`) |
| `POST /magnet/produce` | (legacy) | full payload, exactly 1 fixture; superseded by `produce-for-reply` |
| `GET /{token}` | the prospect | the hosted page (`noindex`, no scripts) |
| `GET /health` | Render | DB ping |

### `produce-for-reply` response

```json
{ "status": "produced", "link": "https://…/<token>", "qa_notes": "…", "production_id": "…",
  "lead_magnet_id": "…", "omitted_inputs": ["company_funding_rounds"], "failure_reason": null, "attempts": 1 }
```

| `status` | HTTP | Meaning for the autoresponder |
|---|---|---|
| `produced` | 200 | send the reply with `link`; `qa_notes` says what the page shows and what was left out |
| `failed` | 200 | no link: flagged + parked, the reply WAITS (ruling 46); `failure_reason` says why |
| `no_magnet` | 200 | the play offers no magnet: draft normally |
| `standard_asset` | 200 | fixed asset, nothing to produce |
| `held` | 409 | the play is live without an approved runtime (gate bypass): hold for a human |
| `not_found` / `ambiguous` | 404 / 409 | the lead reference matches no / several play lead list rows |

Inputs come from, in order: the lead row's `enrichments_used`, the `companies`/`people` fact columns,
the shared `company_enrichments`/`person_enrichments` cache, then (generation_time keys only) the
route's tool through `data_keys` → `route_keys` → `route_tools` → `data_tools`, using the env var
`credential_ref` points at (`BLITZ_API_KEY` or `ENV:NE_API_KEY` style). Callable tools today: the
Blitz HTTP endpoints, and `web.homepage_research.native` (fetches the homepage, writes
`company_research_notes` with the model). Other tools report "not callable by the generator yet" and
their section is omitted. External magnets: the credential is read from the env var named by
`client_integrations.credential_ref`; once the client tool has answered 2xx the run is never
re-POSTed, even if checks or QA fail afterwards (one POST can create a real artifact). A key nothing can supply is left out of the page, never invented. A
required `lead_list` key that is missing fails the run (the go-live gate was bypassed). Build + QA
retry up to `failure_policy.retries` (default 2); every run is logged, pass or fail. The trigger is
`positive_reply` when an `interested` reply row exists for the lead (or `reply_id` is sent), else
`manual`. A repeat call for a reply that already has a produced row returns the same link.

## Checks (custom pages)

`inputs_present · no_placeholders · prospect_named · client_named · client_brand_colors ·
logo_gate_respected · no_em_dashes · cta_top_and_bottom · poc_named_in_cta · carousel_present ·
no_unknown_text · codes_spelled_out · numbers_traceable · noindex · url_resolves · within_turnaround`.
All pass-when-true except `cta_fallback_used` (true = booking link missing on the card).

## Deploy (Render)

`render.yaml` blueprint. Secrets to set: `DATABASE_URL` (service's own schema), `GTMA_DATABASE_URL`
(GTMA's database), `SERVICE_API_KEY`, `OPENAI_API_KEY`, `BLITZ_API_KEY`. `RENDER_EXTERNAL_URL` is
used for page links unless `PUBLIC_BASE_URL` is set. The process must start with cwd `magnet_service/`
since `skills/` is read at runtime.
