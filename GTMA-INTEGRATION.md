# Connecting GTMA to the Lead Magnet Service — integration guide

For whoever wires up the GTMA side (window backend + autoresponder). This service is built and
tested; this doc is everything needed to call it for real.

## 1. What GTMA needs to configure

Two values, as environment variables (or wherever GTMA keeps per-integration config):

| Name | Value |
|---|---|
| `LEAD_MAGNET_SERVICE_URL` | This service's base URL — `http://localhost:8080` for a local live test, or the Render URL once deployed |
| `LEAD_MAGNET_SERVICE_KEY` | The shared secret. Must be the exact same string as `SERVICE_API_KEY` in this service's own `.env` |

Every request to this service needs:
```
Authorization: Bearer <LEAD_MAGNET_SERVICE_KEY>
Content-Type: application/json
```
No key, or the wrong one → `401 Unauthorized`, nothing else happens.

## 2. What this service needs from GTMA's side

**For reply-time to work at all**, this service's own `GTMA_DATABASE_URL` must point at the
**exact same Postgres database** GTMA itself writes to. It does live, read-only lookups
(`play_lead_lists`, `gtm_plays`, `lead_magnets`, `lead_magnet_runtimes`, `companies`, `people`,
`company_enrichments`, etc.) and one write (`magnet_productions`). If GTMA is testing against a
database this service isn't also pointed at, every lookup will come back `not_found`.

Right now this service's `GTMA_DATABASE_URL` points at the `lead_magnet_test_branch` Neon branch.
If GTMA's live test uses a different branch or the production database, **tell me the connection
string first** — this is a one-line env var change, but it has to match on both sides before
anything will resolve.

## 3. Endpoint 1 — building and approving a magnet (unchanged, already spec'd)

```
POST /magnet/build-previews
```
GTMA assembles and sends the full payload (recipe, client brand, proofpoints, up to 10 fixture
leads with resolved values). This is called from the `build-custom-lead-magnet` /
`build-external-lead-magnet` skills during the W1/W2 test loop. Full payload shape:
`magnet_service_dev_kit/magnet-service-contract.md`. This service does no database work for this
call — it's a pure function of the payload.

**Response** (200, synchronous):
```json
{ "lead_magnet_id": "...", "runtime_id": "...", "runtime_version": 1,
  "results": [ { "person_id": "...", "status": "produced", "url": "https://.../<token>",
                 "checks": {...}, "latency_ms": 13400, "failure_reason": null, "notes": [] } ] }
```

## 4. Endpoint 2 — a positive reply (new — this is what needs live testing)

```
POST /magnet/produce-for-reply
```
Called by the autoresponder when a reply is categorized `interested` on a play that carries a
magnet. **The request is just a lead reference** — this service does the rest itself (database
lookup, enrichment, build, QA):

```json
{
  "sequencer": "email_bison",
  "sequencer_campaign_id": "107",
  "sequencer_lead_id": "103430",
  "reply_id": "42"
}
```
`reply_id` is optional. If you have it (you should — GTMA writes the `replies` row before calling
this), send it; it's what makes a retry of the same reply return the same cached link instead of
rebuilding. If omitted, this service looks for an `interested` reply itself, or logs the run as a
one-off manual production if none exists yet.

**Response** (always 200 unless the reference itself doesn't resolve — see status table):
```json
{
  "status": "produced",
  "link": "https://.../<token>",
  "qa_notes": "one or two sentences for drafting the reply — what the page covers, what was left out",
  "production_id": "...",
  "lead_magnet_id": "...",
  "omitted_inputs": ["company_funding_rounds"],
  "failure_reason": null,
  "attempts": 1,
  "cached": false
}
```

### Branch on `status`:

| `status` | HTTP | Meaning | What the autoresponder does |
|---|---|---|---|
| `produced` | 200 | A link is ready | Draft the reply with `link`, using `qa_notes` to know what's covered/omitted |
| `no_magnet` | 200 | This play has no magnet attached | Draft the reply normally, no magnet |
| `standard_asset` | 200 | A pre-existing fixed link (no build happened) | Use the magnet's stored asset link directly |
| `failed` | 200 | Tried, couldn't produce something that passed QA | **Hold the reply.** No link exists yet. Retry later or escalate |
| `held` | 409 | Something's misconfigured upstream (e.g. a live play with no approved runtime) | Alert a human — this means the launch gate was bypassed |
| `not_found` | 404 | That `(sequencer_campaign_id, sequencer_lead_id)` matches no lead | Check the reference is correct |
| `ambiguous` | 409 | More than one lead matched | Shouldn't happen; include `sequencer` to disambiguate |

**Timing:** a produced page usually takes 15–30s. A failing one that retries twice (default policy)
can take up to ~90s. Give the HTTP call at least a 120s timeout.

## 5. How to actually do a live test today

The fastest path, with zero deployment needed: **if GTMA is also running on your own machine**,
point `LEAD_MAGNET_SERVICE_URL` at `http://localhost:8080` and run both at once — that's a real
live test, no Render required.

Steps:
1. I start this service locally (`npm run dev` in `magnet_service/`, or ask me to and I'll leave
   it running).
2. You set `LEAD_MAGNET_SERVICE_URL=http://localhost:8080` and `LEAD_MAGNET_SERVICE_KEY=<the key
   from magnet_service/.env>` in GTMA's local config.
3. Confirm both point at the same database (step 2 above) — otherwise every lookup fails.
4. Trigger a real flow from GTMA's side: either the window's "build previews" action (hits
   endpoint 1), or simulate a positive reply (hits endpoint 2) with a real
   `sequencer`/`sequencer_campaign_id`/`sequencer_lead_id` that exists in `play_lead_lists`.
5. Watch for the response shape above; open the returned `link` to see the actual page.

If instead you need a URL reachable from somewhere other than this machine (GTMA hosted
elsewhere, or Divyansh testing from his own machine), this service needs to be deployed first —
ask me and I'll walk through that, or you push it yourself per `README.md`'s deploy section (the
currently-deployed Render instance is stale and doesn't have the reply-time endpoint yet).

## 6. Known real-data caveat, worth telling whoever's testing

Only one client (**Data Magnet**) has real company/people/magnet/play data on the test branch
right now. Everything else (SocialHP included) has a real magnet definition but no real leads
behind it. A live test against anything other than Data Magnet's one play will come back
`not_found` unless that client's TAM gets built out first.
