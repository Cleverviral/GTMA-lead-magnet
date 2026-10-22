# Connecting GTMA to the Lead Magnet Service

For whoever wires up the GTMA side (Lead Magnet window backend + autoresponder). Endpoint shapes,
fields and status codes are in `API-HANDOVER.md`; this page is the wiring.

## 1. What GTMA configures

| Name | Value |
|---|---|
| `LEAD_MAGNET_SERVICE_URL` | `https://gtma-lead-magnet.onrender.com` |
| `LEAD_MAGNET_SERVICE_KEY` | the shared secret (the service's `SERVICE_API_KEY`), sent privately |

Every request: `Authorization: Bearer <LEAD_MAGNET_SERVICE_KEY>` and `Content-Type: application/json`.

## 2. Same database on both sides

The service's `GTMA_DATABASE_URL` points at GTMA's production Neon database. It reads the lookup
chain (`play_lead_lists`, `gtm_plays`, `lead_magnets`, `lead_magnet_runtimes`, `companies`,
`people`, the enrichment cache, `data_keys` and routes, `client_integrations`) and writes only
`magnet_productions`. If GTMA moves to another database, both sides must change together.

## 3. Generate previews (the window)

When the user clicks "Generate previews", GTMA calls `POST /magnet/build-previews` with the draft
recipe, the booking link, proofpoints, and 5 preview people (custom) or companies (external),
identified by `person_id` + `company_id`. Send only the values already on the list; the service
fetches the paid values itself. Write the 5 results (links, checks, values used) into the draft
runtime's `test_report`. Nothing goes back to the service on approval.

External setups send the connection in `magnet.integration` (with the key, for these calls only)
and the request mapping, method, header and link field in `recipe.output_contract`, the same place
the frozen recipe keeps them.

## 4. A positive reply (the autoresponder)

Call `POST /magnet/produce` with `{sequencer, campaign_id, lead_id, reply_id}`. The service finds
the lead, builds the page from the magnet's current approved recipe, runs its QA prompt, logs one
`magnet_productions` row and returns the link.

`reply_id` must be a real `replies` row: the database refuses a reply run without one. Until
ruling 105 is decided, a call without it is answered `held` and nothing is built. So the question
for the autoresponder is whether the reply row exists before it calls us.

## 5. Before go-live on replies

- Ruling 105: the reply link (above).
- The external tool's key must be in the secret store under the name `credential_ref` points at
  (today: an env var on the Render service).
- The finder data sources (`company_case_study_customers`, `company_target_market`) registered on
  the live database, for related-companies magnets.
- `gtma-v4-delta-lead-magnets.sql` can be applied at any time: the service works before and after it.
