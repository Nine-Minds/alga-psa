# PR #3880 mitigation verification — current environment (2026-11-04)

## Revisions and scope

- Final PR evidence revision at the time of the post-publication service restart: `ceea010c606f94bd2fbf504603471cc9e27e812e`. The earlier real-browser template captures were made on `a241a91b06e2d48e692f5c20bd58b0c84f214933`; the diff between these commits contains only evidence documentation. The current serving Ryzen checkout was fast-forwarded and lifecycle-restarted at `ceea010c...` before the final health/sign-in probes.
- Published dossier/source revision: `7ed5e379d4fe6d3dfd1158fbd60ec0043b9e8ebb`. `git diff 7ed5e379..HEAD -- ':!docs/evidence/pr3880-priority-board'` is empty, so the implementation source currently served is byte-for-byte the published source; commits since it only changed evidence documentation.
- Existing uncommitted change in `packages/tickets/src/lib/ticketFieldReferences.ts` was present at task start and is preserved, unstaged and uncommitted.
- No matching approved plan exists under `docs/plans`; the attached card specification and prior takeover evidence remain the available scope record.

## Host routing repair and service lifecycle

The actual failure was in the deployed Alga Dev agent, not the Alga PSA source. I traced board `workflow-ensure-service` through the project host router to `HostRouterService.ensureHost() -> loadHints() -> getStore3()` in the active bundled `src/main/remote-hosts/HostRouter.ts`. At bundle line 62584, `getStore3()` constructed the `electron-store` `remote-hosts` store without `projectName`. Both X670E and Ryzen active agent bundles (`20261104000126-g692866e297`) had this exact missing option. The projectName literals at unrelated Store constructors did not fix this execution path.

I preserved each original bundle as `service/index.mjs.before-pr3880-20261104`, patched this specific Store constructor on both hosts with `projectName: "ghostty-pane-ide"`, and restarted each `alga-dev-agent.service`. The current active X670E bundle now has `projectName` at the `HostRouter` constructor, confirmed by reading the executed source context around the `// src/main/remote-hosts/HostRouter.ts` module. The repair is an operational Alga Dev runtime change outside the PSA repository; Alga Dev has not yet published a new agent release containing it.

Using board lifecycle, `workflow-ensure-service` resumed the pre-existing `dev-server:1` registration on Ryzen. It remains `live`, cwd `/home/robert/alga-copies/feature-validate-priority-type-against-board-recurring-t/server`, command `PORT=3810 npm run dev`, with board session ID `card-service:d4555320-ddb9-46dd-ac25-5ad49bc25721:dev-server:1`. A one-hour step-scoped hold expires `2026-11-04T01:18:34.482Z`. A mistakenly created diagnostic duplicate `dev-server:5` was immediately concluded through lifecycle; it is not serving the app.

The Ryzen checkout was fast-forwarded to the PR branch at `a241a91b06e2d48e692f5c20bd58b0c84f214933`. Its stale ignored `server/.next-dev` was preserved under `server/.next-dev.stale-pr3880-a241-20261104-0012/` before the board service restart. The Next config alias remains `@alga-psa/core/capability` → `packages/core/src/lib/capability.ts` (`server/next.config.mjs`, line 306); no alias source workaround was made. The browser's `.localhost` URL reached the Ryzen service through a temporary X670E loopback SSH forward to that same existing board-managed service, not a second app server.

## Current browser and HTTP checks

- A fresh real card browser pane `3c471de2-b8db-4889-a0d8-9fed53c26374` signed in as the dossier QA user and rendered `/msp/dashboard` with title `Dashboard | AlgaPSA`.
- With the card Host header, `/api/health` returned HTTP 200 and `{"status":"ok","version":"1.0.0"}`; `/auth/msp/signin` returned HTTP 200. Exact responses are recorded in [HTTP checks](current-http-checks-2026-11-04.txt); it includes both initial browser-session probes and post-publication probes against serving checkout `ceea010c...`. The browser's dashboard screenshot and short sign-in recording are attached below.
- The real browser then navigated to `/msp/tickets`; route text hydration completed, but the recording does not show the priority-validation scenarios. Repeated local notifications WebSocket attempts to `ws://localhost:13301` fail with connection-refused errors; this is separate from app health/sign-in.
- Current artifacts: [dashboard screenshot](mitigation-dashboard-2026-11-04.png), [tickets screenshot](mitigation-tickets-2026-11-04.png), [browser recording](current-mitigation-2026-11-04.webm), [chapter metadata](current-mitigation-2026-11-04.json), [captions](current-mitigation-2026-11-04.vtt). The recording shows sign-in and dashboard, not template/API/schedule/generator interactions.

## Database and behavior evidence boundary

No fixture, migration, or generator writes were made in this mitigation attempt. Existing fixture state, saved legacy audience objects, backups, and inactive smoke-schedule activity were left untouched. Current browser evidence covers authentication, dashboard/ticket route reachability, and both cross-family template warning/save-refusal directions. There is no new current-revision evidence for the missing-priority template warning and valid repair/reload, manual ticket/API mismatches, definition/client cascade saves, or maintenance-event generator occurrences. Those scenarios remain covered only by the explicitly historical 2026-11-03 artifacts in [takeover-2026-11-03.md](takeover-2026-11-03.md), which were exercised at the same application source tree (`7ed5e379...`; source unchanged at current `a241a91b...`). Do not treat them as a fresh 2026-11-04 run.

The production mismatch report remains read-only and informational. Its recorded recommendation is informational reporting followed by separately captain-approved customer-data cleanup; no production query or write was performed here.

## Checks run at current revision

- `npm test -- src/components/templates/__tests__/TicketTemplateEditor.fromTicket.test.tsx` in `packages/tickets`: passed, 1 file / 9 tests.
- `npm test -- src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx src/components/__tests__/QuickAddTicket.template.test.tsx src/components/recurring/__tests__/recurringUi.test.ts src/lib/__tests__/ticketTemplateSchema.test.ts src/lib/__tests__/instantiateTicketTemplate.clientScope.test.ts src/lib/recurring/__tests__/effectiveFields.test.ts` in `packages/tickets`: passed, 6 files / 61 tests.
- `npm run typecheck --workspace=@alga-psa/tickets`: passed.
- `npm run typecheck --workspace=server`: default Node heap attempt failed at ~4 GiB; `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=server`: passed.
- `npm test --workspace=server -- src/test/integration/priorityBoardType.integration.test.ts src/test/integration/recurringTicketGenerator.integration.test.ts` invoked the package script, which hardcodes the full unit suite with `SKIP_DB_TESTS=1`; it did not select the named integration suites. That full suite was interrupted after several minutes and is not counted as a pass. The direct database integration suites remain unrun. No tests or migrations were run against either `server_card_d4555320` or shared `server` during this attempt.
- The previous attempts' focused UI/typecheck/build and integration harness results are historical; see [historical mitigation record](mitigation-verification-2026-11-03.md) and [takeover report](takeover-2026-11-03.md).
- `NODE_OPTIONS=--max-old-space-size=24576 npm run build --workspace=server`: passed at current checkout `a241a91b...`; compiled in 7.2 minutes and generated 74 pages. Existing warnings included a duplicate scheduling star export and webpack critical-dependency/serialization notices.

## Reviewer focus

Review the exact two-host `HostRouter` runtime repair and the successful original board registration resume first. Current browser evidence confirms service availability, sign-in, and both legacy cross-family template warning/refusal directions. The requested missing-priority/valid-repair, manual API, schedule, and generator checks remain outstanding; prior behavior evidence is clearly marked historical. The unrelated `ticketFieldReferences.ts` worktree edit is intentionally preserved outside evidence commits.
