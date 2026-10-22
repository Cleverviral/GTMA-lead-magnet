# Render an external lead magnet (service-side) — flow settled 2026-10-21 (rulings 72-86, 93, 95)

External = "Connect your own lead magnet": the client's own tool makes the deliverable, the
generator calls its API. The user set it up in the Lead Magnet window; you receive the result.

## What you get
- The connection: base address, endpoint, method, login type (API key header, bearer token,
  or username and password) and the credential. During setup GTMA passes the credential
  in-flight for those calls only; at reply time you read it yourself from the secret store
  through `client_integrations.credential_ref`, with your own limited role (ruling 95).
  Never store or log the credential.
- The request mapping: each field the API needs mapped to a GTMA data key. Every field is a
  data key value; there are no templates or hand-typed values.
- The link field: the one JSON field in the response that holds the link (e.g. report_url).

## Setup calls (test call + 5 previews)
GTMA sends the values for 5 REAL companies from the client's qualified company list
(ruling 79). The user has approved the calls. Each call creates a real item in the client's tool:
make exactly one call per company, no blind retries after a success. Return each link with its
check results; GTMA keeps them in the recipe's test report. Preview calls are never
magnet_productions rows (rulings 85, 93): that table is for real reply runs only.

## Reply-time calls
Read the frozen recipe; get this lead's values cheapest first (the lead row, stored facts,
the shared cache, then a paid data-key lookup); call the API once; take the link from the
link field; run the frozen QA prompt; log your run in magnet_productions (with `runtime_version`, the recipe version you ran, ruling 115); return the link.

## Rules
1. Use the link the API returns in the link field. Never build the client's URLs yourself.
2. Links only, returned in the same answer (about a minute). An API that returns text, a file
   or data, or answers later with a job id, is not supported: fail clearly.
3. Checks per call: the call succeeded, the link field is present, the link opens, the right
   company is named.
