# PR #3880 mitigation verification — historical 2026-11-03 results

> Historical record: this document was written before the current recovery. Its checkout, service, and blocked-verification statements below describe the 2026-11-03/early-2026-11-04 attempt only. They are superseded for current environment status by [current mitigation verification](current-mitigation-2026-11-04.md). Historical test results are not evidence for the current verification.

## Historical follow-up attempt (2026-11-04)

- The branch is now at `9f1affb46f00e02e00d27cb18dd0d003dcbe0c09`; `origin/feature/validate-priority-type-against-board-recurring-t` points to the same revision. The published dossier revision `7ed5e379d4fe6d3dfd1158fbd60ec0043b9e8ebb` is an ancestor, not the current checkout.
- The prior uncommitted source edit in `packages/tickets/src/lib/ticketFieldReferences.ts` remains present and was not changed in this attempt. It is not included in evidence commits.
- Current board records still show the card host as X670E, while its existing `dev-server` registration is on Ryzen and suspended. `workflow-restart-service` reports no live service; `workflow-ensure-service` fails with `Please specify the projectName option`. The current X670E deployed bundle `20261104000126-g692866e297` contains `projectName: "ghostty-pane-ide"`, so the failure remains unresolved in the board/remote host path. The service was not bypassed or launched separately.
- Card hostname probes to `/api/health` and `/auth/msp/signin` both fail to connect while the registered service is suspended. Consequently this attempt could not verify the served revision or perform fresh browser or generator checks. The prior takeover artifacts remain historical evidence only.
- `server/next.config.mjs` still maps `@alga-psa/core/capability` to `../packages/core/src/lib/capability.ts` at line 306. No alias workaround was added. The card database was not touched.
- The required current-state fact was recorded on the Draft Implementation step as fact `29842169-3bac-48b4-bf69-723b95734734`.

## Scope and checkout

- Branch: `feature/validate-priority-type-against-board-recurring-t`; published HEAD is `7ed5e379d4fe6d3dfd1158fbd60ec0043b9e8ebb`.
- No matching implementation plan exists in `docs/plans/`; the named attached `plan.md` and `~/.alga-xo/designs/d4555320.md` were not present. The card specification and committed takeover report remain the available scope record.
- The only worktree source delta observed at the start and end of this round is an existing, uncommitted edit to `packages/tickets/src/lib/ticketFieldReferences.ts`. It was preserved and is not included in this evidence commit.
- Existing complete UI/API/cascade/generator evidence remains in `takeover-2026-11-03.md`, its linked screenshots and video, and `template-and-ticket-db-takeover.txt` / `generator-results.txt`. Those artifacts record the earlier run; they are not represented as a new run here.

## Browser and service routing

- The card's project space exists on Ryzen (`39e55a10-5534-42dc-a41f-3d088e2bee25`). The prior browser pane was stale. A fresh browser pane (`9e4bb361-ee35-4b83-bda1-ab5a1fb3df66`) was created in that existing card space and responds through the X670E viewer. The old pane still reports cross-host ownership when called from Ryzen.
- The card record's `hostId` is `ts:robert-X670E-Pro-RS`; the existing `dev-server` registration is on Ryzen, cwd `/home/robert/alga-copies/feature-validate-priority-type-against-board-recurring-t/server`, command `PORT=3810 npm run dev`.
- The board registration is suspended because Draft Implementation does not use `dev-server`. A direct health/sign-in probe to Ryzen port 3810 failed to connect. `workflow-ensure-service` was attempted against the existing registration and returned `host-unavailable:ts:robert-X670E-Pro-RS` / no `wf.agent.ts_robert-X670E-Pro-RS.cmd` responder. No separate server was started.
- NATS `/healthz` is OK and Ryzen is the JetStream metadata leader. Some streams still show non-current replicas. No stream membership, replica settings, or data were changed. This does not establish full replica convergence.
- The checked-in Turbopack mapping remains `@alga-psa/core/capability` → `../packages/core/src/lib/capability.ts` in `server/next.config.mjs` (line 306). The published revision was verified from the checkout; the service was not running, so its runtime revision could not be re-verified.

## Checks run in this round

- Ticket package typecheck: passed.
- UI suites: 4 files, 42 tests passed (`TicketInfo.boardChangeStatusReselection`, `TicketTemplateEditor.fromTicket`, `QuickAddTicket.template`, recurring UI).
- Server typecheck with `NODE_OPTIONS=--max-old-space-size=8192`: passed.
- Production Webpack build with `NODE_OPTIONS=--max-old-space-size=24576 npm run build:webpack`: passed, exit 0; compiled in 8.2 minutes and generated 74 static pages. Existing warnings included the duplicate scheduling star export and webpack serialization/Edge runtime warnings.
- `priorityBoardType.integration.test.ts` was run with unique `TEST_DB_NAME=pr3880_priority_type_verification_20261103_2338`. Database setup failed with PostgreSQL `28P01 password authentication failed for user "postgres"` on the isolated test endpoint at port 5472; all 12 tests were skipped before assertions. No test database was recreated and neither `server_card_d4555320` nor the shared `server` database was touched. Template, recurring, generator, action/API integration suites therefore remain unverified in this round.
- Browser scenarios and new screenshots/video/database results could not be captured because the board-managed app service remained suspended. The previously committed takeover evidence still covers those product flows at the published source revision.

## Production data

The committed [read-only per-tenant report](production-counts.md) already contains the production result: 11,947 open-ticket priority mismatches across 18 tenants; 1,480 informational category mismatches across five tenants; zero template/recurring mismatches. No repeat query was needed. Keep the report informational and obtain separate captain approval before any cleanup; no production writes were performed.

## Remaining reviewer focus

Restore the card project's host routing so its existing Ryzen service can be resumed by board control, then verify the service revision, sign in through the fresh browser pane, and capture current UI/API/cascade/generator evidence. Review the preserved `ticketFieldReferences.ts` worktree edit separately before it is included in any source commit.
