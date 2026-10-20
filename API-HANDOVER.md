# Lead Magnet Service — API Handover

2026-10-14 ·

The Lead Magnet render service is live at `https://gtma-lead-magnet.onrender.com`, with two
endpoints: build previews before approval, and produce a magnet live when a prospect replies
positively. Both are tested end to end against real data.

## Authentication

Every request to either endpoint needs one header:

```
Authorization: Bearer <SERVICE_API_KEY>
Content-Type: application/json
```

No key, or the wrong one, returns `401 Unauthorized` and nothing else happens. The key will be
shared with you separately, over a private channel.

## Endpoint 1 — building and approving a magnet

```
POST /magnet/build-previews
```

Called by GTMA's window during the build/test loop, before a magnet is approved. GTMA sends one
self-contained payload (the recipe, the client's brand, up to 10 fixture leads with values already
resolved); this service builds and hosts that many pages and returns the links. No database lookup
happens on this path — it's a pure function of the payload.

**Response** (200, synchronous):

```json
{
  "lead_magnet_id": "...",
  "runtime_id": "...",
  "runtime_version": 1,
  "results": [
    {
      "person_id": "...",
      "status": "produced",
      "url": "https://gtma-lead-magnet.onrender.com/<token>",
      "checks": { "client_brand_colors": true, "carousel_present": true },
      "latency_ms": 13400,
      "failure_reason": null
    }
  ]
}
```

Full payload shape: `magnet-service-tool-kit/magnet-service-contract.md` in the repo.

Optional fields added in kit v3:

| Field | What it's for |
|---|---|
| `client.client_id` | the client's id; needed for related-companies magnets (do-not-contact list) |
| `client.brand_colors` | may be `{"default": true}`; the page then uses the house palette |
| `resources` | `[{title, description, url}]` from the client's `assets`; the carousel when there are no case studies |
| `play` | `{name, summary, offer, reply_guidance}`; looked up from `gtm_play_id` when left out |
| `fixtures[].related_companies` | send this only if GTMA picks the related companies itself; otherwise the service finds them |

For related-companies magnets, the service reads GTMA's database (read-only) during previews too.

## Endpoint 2 — a positive reply

```
POST /magnet/produce-for-reply
```

Called by the autoresponder when a reply is categorized `interested` on a play that carries a
magnet. The request is just a lead reference — this service does the rest itself (database lookup,
live enrichment, build, QA):

```json
{
  "sequencer": "email_bison",
  "sequencer_campaign_id": "107",
  "sequencer_lead_id": "103430",
  "reply_id": "42"
}
```

`reply_id` is optional but recommended — send it if you have it. It's what makes a retry of the
same reply return the same cached link instead of rebuilding. Without it, this service looks for an
`interested` reply itself, or logs the run as a one-off manual production if none exists yet.

**Response:**

```json
{
  "status": "produced",
  "link": "https://gtma-lead-magnet.onrender.com/<token>",
  "qa_notes": "one or two sentences for drafting the reply",
  "production_id": "...",
  "lead_magnet_id": "...",
  "omitted_inputs": ["company_funding_rounds"],
  "failure_reason": null,
  "attempts": 1,
  "cached": false
}
```

**Branch on `status`:**

| `status` | HTTP | Meaning | What to do |
|---|---|---|---|
| `produced` | 200 | A link is ready | Draft the reply with `link`; use `qa_notes` to know what's covered or left out |
| `no_magnet` | 200 | This play has no magnet attached | Draft the reply normally, no magnet |
| `standard_asset` | 200 | A pre-existing fixed link, nothing was built | Use the magnet's stored asset link directly |
| `failed` | 200 | Tried, couldn't produce something that passed QA | Hold the reply — no link exists yet. Retry later or escalate |
| `held` | 409 | Something's misconfigured upstream (e.g. a live play with no approved runtime) | Alert a human — the launch gate was bypassed |
| `not_found` | 404 | That `(sequencer_campaign_id, sequencer_lead_id)` matches no lead | Check the reference is correct |
| `ambiguous` | 409 | More than one lead matched | Shouldn't happen; include `sequencer` to disambiguate |

## Timing and retries

A produced page usually takes 15–30 seconds. A failing one that retries twice (the default policy)
can take up to about 90 seconds before the final answer comes back. Give the call at least a
120-second timeout — a timeout on your side does not cancel the build, so a retry with the same
`reply_id` will return the result once it's ready rather than starting over.


