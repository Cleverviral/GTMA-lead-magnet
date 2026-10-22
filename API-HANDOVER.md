# Lead Magnet Service — API Handover

2026-10-22 · matches contract v5 (`magnet-service-tool-kit/docs/magnet-service-contract.md`)

The Lead Magnet service is live at `https://gtma-lead-magnet.onrender.com`. GTMA calls it to
generate previews in the Lead Magnet window, and the autoresponder calls it when a prospect replies
positively. Same two endpoints as before; what they accept and return changed as listed below.

## Authentication

Every request needs:

```
Authorization: Bearer <SERVICE_API_KEY>
Content-Type: application/json
```

A missing or wrong key returns `401` and nothing runs. The key is shared separately, over a
private channel.

## Endpoint 1: generate previews (GTMA → service)

```
POST /magnet/build-previews
```

Called by the "Generate previews" step. GTMA sends the draft recipe, the client's booking link,
proofpoints, and 5 preview people (custom) or 5 companies (external). The service builds and
hosts the 5 pages (or calls the client's tool 5 times) and returns the links with their checks.
GTMA saves the results in the recipe's `test_report`. Previews are never written to
`magnet_productions`.

What changed in v5:

| Field | Now |
|---|---|
| `fixtures[]` | identified by `person_id` + `company_id`; no `lead_list_id` (nobody is claimed for a preview). External previews may send companies only (`company_id`, no person) |
| `fixtures[].inputs` | only the values already on the list. The service fetches the rest itself (shared enrichment cache first, then the data key's tool), the same way as at reply time |
| `fixtures[].company` | `employees_on_linkedin` (the old `employee_count` still works) |
| `client` | `client_name`, `website`, `booking_url`. No colours, no logo: pages use each prospect's own colours. `booking_poc_name` is never shown on the page; leave it out |
| `gtm_play_id` | optional (the window works without a play) |
| `resources` | optional. If GTMA sends no proofpoints and no resources, the service reads the client's own assets itself |
| `magnet.hosting` | `ours` (the shared neutral domain) or `client_domain` with the verified subdomain in `hosted_base_url` |

**Response** (200, synchronous; about 20 to 30 seconds for 5 custom pages):

```json
{
  "lead_magnet_id": "...",
  "runtime_id": "...",
  "runtime_version": 1,
  "results": [
    {
      "person_id": "...",
      "company_id": "...",
      "status": "produced",
      "url": "https://gtma-lead-magnet.onrender.com/datassential-wfrzvp",
      "latency_ms": 25000,
      "checks": { "prospect_brand_colors": true, "bottom_order": true, "carousel_present": true },
      "values_used": { "company_domain": "datassential.com" },
      "failure_reason": null,
      "notes": ["colour #00a380 from the prospect's logo"]
    }
  ]
}
```

Links are now the company name plus a short random code (`/datassential-wfrzvp`). Older links keep
working.

Checks: every check is pass-when-true, except `default_palette_used` (true = no prospect colour
passed, ember orange used) and `cta_fallback_used` (true = no booking link, the button goes to the
client's website). Both are flags for the window; the page is fine.

### External magnets ("Connect your own lead magnet")

Same endpoint, `magnet.kind = "external"`. Send the connection in `magnet.integration` and the
frozen settings in `recipe.output_contract` (where GTMA stores them):

```json
"magnet": {
  "kind": "external",
  "integration": { "base_url": "https://api.client.com", "auth_kind": "api_key",
                   "credential": "<the key, for these calls only>", "endpoint_path": "/v1/reports" }
},
"recipe": {
  "output_contract": {
    "method": "POST", "header": "x-api-key", "link_field": "report_url",
    "request_mapping": [ { "field": "company_domain", "data_key": "company_domain" },
                         { "field": "industry", "data_key": "company_industry" } ]
  }
}
```

- Logins: `api_key` (needs `header`), `bearer`, `basic` (credential as `username:password`).
  Anything else returns "This login method isn't supported yet" and nothing is called.
- One call per company. The first call is the test call: if the key is refused, or the tool
  answers with a job id, text, or no link, the other 4 are skipped with that reason.
- Checks per call: `call_succeeded`, `link_field_present`, `link_opens`, `right_company_named`,
  `same_answer_under_60s`.

## Endpoint 2: a positive reply (autoresponder → service)

```
POST /magnet/produce
```

(`/magnet/produce-for-reply` still works and does the same thing.)

The request is a lead reference only. The service walks the lookup chain itself, builds the page
(or calls the client's tool), runs the frozen QA prompt, and writes one `magnet_productions` row.

```json
{ "sequencer": "email_bison", "campaign_id": "107", "lead_id": "103430", "reply_id": "42" }
```

The older `sequencer_campaign_id` / `sequencer_lead_id` names are accepted too.

**`reply_id` is required for now.** The database refuses a reply run without its reply, and linking
a run to its reply is on hold (ruling 105). Without a real `reply_id` the service answers `held`
and builds nothing. This is the open question for the autoresponder: is the reply row saved
before the autoresponder calls us, or only after it has replied?

**Response:**

```json
{
  "status": "produced",
  "link": "https://gtma-lead-magnet.onrender.com/datassential-wfrzvp",
  "qa_notes": "one or two sentences for drafting the reply",
  "production_id": "...",
  "lead_magnet_id": "...",
  "omitted_inputs": [],
  "failure_reason": null,
  "attempts": 1
}
```

| `status` | HTTP | Meaning | What to do |
|---|---|---|---|
| `produced` | 200 | A link is ready | Send the reply with `link`; `qa_notes` says what the page covers |
| `no_magnet` | 200 | The play has no magnet | Reply normally |
| `standard_asset` | 200 | A fixed asset, nothing was built | Use the stored asset link |
| `failed` | 200 | Retries used up, nothing passed QA | Hold the reply; the run is logged and the developer is flagged |
| `held` | 409 | No `reply_id`, an unknown `reply_id`, or a live play whose magnet has no approved recipe | Hold the reply and alert a human |
| `not_found` | 404 | No lead matches that campaign + lead id | Check the reference |
| `ambiguous` | 409 | More than one lead matched | Include the right `sequencer` |

A repeat call for the same reply returns the same link. Give the call a 120-second timeout; a
timeout on your side does not cancel the build.

## Database notes (for the developer)

- The service reads GTMA's database and writes only `magnet_productions` (one row per reply run,
  `trigger = 'positive_reply'`).
- It works before and after `gtma-v4-delta-lead-magnets.sql`: it no longer reads the client
  colour, logo or test-mode columns, and it fills `magnet_productions.runtime_version` once that
  column exists.
- External keys are read from the secret store through `client_integrations.credential_ref` (today:
  the env var it names, set on the Render service).
