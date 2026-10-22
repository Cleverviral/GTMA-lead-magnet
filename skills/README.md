# Magnet service skill bundle — ships WITH the Render service (2026-10-07)

These files are the Lead Magnet service's own knowledge. The service reads Postgres with its
own limited role and writes exactly ONE table, magnet_productions, one row per real reply run
(rulings 52, 98); previews are never rows there (ruling 93). Per request it receives the
preview payload or a reply-time lead reference (docs/magnet-service-contract.md) and executes
the recipe's `skill_md` AGAINST these bundled skills. Split of brains:

| Side | Skills | Job |
|---|---|---|
| **GTMA** (window agent + backend) | discover-gtm-play, lead-magnet-brainstorm, the window contract, launch-play, enrich-play-lead-list | decide WHAT the magnet is, author the per-magnet recipe, judge + QA + approve, write test_report, the freeze and the delivered marks |
| **Service** (this bundle + its spec) | skills-v2/run-lead-magnet (the generator's own reply-time spec, ruling 98), design-custom-lead-magnet.md, render-external-lead-magnet.md, fetch_logo.py (+ README), fetch_brand_colors.py, finders/ | know HOW to build: turn recipe + values into hosted HTML (or a client-API deliverable), return URLs + check results, log each reply run in magnet_productions |

The per-magnet `skill_md` is the PARAMETERIZATION (this magnet's structure, logic, wording);
this bundle is the CRAFT (the always-rules every magnet obeys). A design-rule change updates
this bundle once; a magnet change only touches its recipe.
