# Board-managed dev-server routing recovery (2026-11-03)

## Fresh inspection and repair

- Published application revision: `7ed5e379d4fe6d3dfd1158fbd60ec0043b9e8ebb` on the Ryzen service checkout.
- The card service registration `d4555320-ddb9-46dd-ac25-5ad49bc25721:dev-server` is bound to `ts:robert-Desktop-AMD-Ryzen-AI-Max-300-Series`, port 3810, command `PORT=3810 npm run dev`.
- The card project record currently names `ts:robert-X670E-Pro-RS`. This is identity drift between the card and its service registration. The service listing still correctly identifies the existing process host as Ryzen.
- `workflow-ensure-service` initially failed on Ryzen with `Please specify the projectName option`. Inspection of active bundle `202611032243-g692866e297` found the Ryzen `HostRouter` `remote-hosts` electron-store omitted `projectName`. Added `projectName: "ghostty-pane-ide"` to that constructor and saved `index.mjs.before-pr3880-routing-20261103` beside it. The active X670E bundle already contained the option; its active bundle snapshot was also preserved. Both agents were restarted.
- JetStream `/healthz` returned `{"status":"ok"}` and board service commands responded. No stream membership or replica settings were changed; replica convergence was not verified.
- The existing board control `workflow-ensure-service` resumed the existing service registration; no separate PSA process was started. The server log reached `[dev-server] ready`.

## Current application checks

- The Ryzen checkout reports the published revision above. The Turbopack alias for `@alga-psa/core/capability` is already present at `server/next.config.mjs:306`; it was not changed.
- With `Host: feature-validate-priority-type-against-board-recurring-t.localhost:3810`, `/api/health` returned HTTP 200, `/api/auth/providers` returned HTTP 200, and `/auth/msp/signin` returned HTTP 200. Requests without the card hostname can be redirected by tenant/domain middleware.
- The board lifecycle suspended the service again at `2026-11-03T23:08:17Z` because the current step is Draft Implementation and does not use `dev-server`. A later probe confirmed port 3810 was closed. Thus the successful probe is fresh but the service is not yet reliably held for a smoke run.
- The registered browser tabs are visible in layout metadata, but browser IPC is not available for their Ryzen-owned panes. Current UI smoke, video, screenshots, and database checks could not be captured. `takeover-walkthrough.webm`, the screenshots, and database results in this directory are retained evidence from the earlier takeover revision, not fresh results for this recovery.

## Check status

- Tickets package typecheck on this checkout: passed.
- Server typecheck with Node defaults: failed at the ~4 GB V8 heap limit (exit 134). Retry with `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`: passed.
- Production build with `NODE_OPTIONS=--max-old-space-size=24576 npm run build`: passed (exit 0). Webpack compiled in 5.1 minutes and all 74 static pages generated. Existing warnings include a conflicting star export in scheduling and dynamic dependency warnings; none blocked the build.
- Attempted `priorityBoardType.integration.test.ts` and `recurringTicketGenerator.integration.test.ts` with `TEST_DB_NAME=pr3880_priority_test_20261103` and one worker. Both suites failed during database setup because the test PostgreSQL at port 5472 rejected the `postgres` password; all 33 tests were skipped. No tests reached assertions and no database was mutated.
- Evidence was pushed to PR #3880 at branch commit `cc9d92283dc6fd66717653dc8a031bf850abaa60`. CI for that commit was queued when inspected; no CI result is claimed.
- Existing takeover evidence records 44 affected UI tests passing, tickets/server typechecks passing, and a production build passing at `a055d8c541d6751d575eb8b200ca8053d54b6674`; the application source was unchanged for that build. Those results are prior evidence, not a new smoke run.

## Plan and scope notes

- No matching plan file was found under `docs/plans` using `git log main..HEAD --name-only -- docs/plans`. `~/.alga-xo/designs/d4555320.md` and an attached `plan.md` were unavailable. The card description and prior committed takeover report were used as the approved scope record.
- No application-code repair was indicated by the current HTTP checks. The pre-existing uncommitted edit in `packages/tickets/src/lib/ticketFieldReferences.ts` was preserved and not included in this evidence commit.
- The read-only production report and per-tenant counts remain unchanged. No customer data or shared `server` database was modified.
