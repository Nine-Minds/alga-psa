# Scratchpad — Ticket bundles: adding an open ticket to a closed master

- Plan slug: `2026-09-18-ticket-bundle-closed-master-add-child`
- Created: 2026-09-18
- Ticket: alga-2026-0002507 (full spec is the internal comment on the ticket)
- Worktree: `/home/robert/alga-copies/feature-ticket-bundles-open-ticket-added-to-a-closed-mas`, branch `feature/ticket-bundles-open-ticket-added-to-a-closed-mas`, dev server port 3312, compose project `alga-psa-local-test`

## Decisions

- (2026-09-18) One shared policy module in `ticketBundleUtils.ts`, consumed by both server actions and `TicketService`. `TicketService` already imports `maybeReopenBundleMasterFromChildReply` from there, so it is the established server-only shared home for bundle logic.
- (2026-09-18) The attach logic exists four times (`bundleTicketsAction`, `addChildrenToBundleAction`, `TicketService.bundleTickets`, `TicketService.addBundleChildren`) with near-identical checks. Since every one of the four now needs the closed-master policy, extract one `attachChildrenToBundle` engine returning failure codes; the action and service layers only map codes to their error types. Drop `// LEVERAGE: pattern bundle-attach-engine` at the sites if the extraction is deferred.
- (2026-09-18) Apply the policy to bundle *creation* too, not just add-children: the list dialog calls `bundleTicketsAction` for both new and existing masters (it upserts `ticket_bundle_settings`). Pending captain confirmation (PRD open question 1).
- (2026-09-18) Reopen must not go through `updateTicketWithCache`: its `sync_updates` block (`optimizedTicketActions.ts` ~L3076) updates every row with `master_ticket_id = master` for `status_id/closed_at/closed_by`. The master-only row update in `maybeReopenBundleMasterFromChildReply` is the right primitive; extract it and publish the human-reopen events after commit ourselves (`TICKET_UPDATED` with `changes.status_id` for the SLA subscriber's pause/resume + notifications; `TICKET_REOPENED` transition event for workflows).
- (2026-09-18) "Open child" predicate = `closed_at IS NULL`, matching `validateTicketClosure.ts` `require_no_open_children`. Reuse one helper for both.
- (2026-09-18) Mirroring the resolution reuses the `sync_updates` mirror shape (comment_threads + comments with `is_system_generated`, `user_id null`, `author_type 'unknown'`, row in `ticket_bundle_mirrors` keyed by source comment + child) so it is idempotent and the child comment is immutable like other mirrors.
- (2026-09-18) API field is snake_case `on_closed_master` (bundle schemas are snake_case). Brief says `onClosedMaster`; pending captain confirmation (open question 2).

## Discoveries / Constraints

- `addChildrenToBundleAction` (ticketBundleActions.ts ~L250) selects only `ticket_id, master_ticket_id` from the master; the closed state needs a join to `statuses.is_closed` (or `tickets.is_closed`, which `updateTicketWithCache` keeps in sync). Prefer the `statuses` join like `maybeReopenBundleMasterFromChildReply` does.
- Close rules row: `getBoardCloseRulesRow(trx, tenant, boardId)` in `shared/lib/ticketCloseRules.ts`; `require_no_open_children` is a boolean on `board_close_rules`. Rules are board-scoped, so the gate depends on the **master's** board.
- `enforceTicketCloseRules` (validateTicketClosure.ts) needs `{ ticket_id, board_id, category_id, subcategory_id, priority_id, assigned_to }` of the ticket being closed; for `apply_resolution` that is each child.
- `updateTicketWithCache` close path (optimizedTicketActions.ts ~L2604–2850): `is_closed`, `closed_at`, `closed_by` set on the row; `TICKET_CLOSED` published after commit via `registerAfterCommit`; `CLOSED` activity written with curated diff. The child close in `apply_resolution` mirrors these writes directly (it cannot call `updateTicketWithCache` because bundled children have workflow fields locked — ~L2504 throws for status changes on a bundled child).
- Resolution comment marker used by close rules: `is_resolution = true OR metadata->>'closes_ticket' = 'true'` (validateTicketClosure.ts ~L98). Use the same predicate, restricted to `is_internal = false`.
- Ticket list bundle stats subquery is in `optimizedTicketActions.ts` ~L1837 (`bs.bundle_child_count`, `child_client_ids`); the master badge is rendered in `packages/tickets/src/lib/ticket-columns.tsx` ~L299. `ITicketListItem` shape in `packages/tickets/src/schemas/ticket.schema.ts` ~L129.
- Consolidated bundle payload built in `getConsolidatedTicketData` ~L965–1090; children selected without `is_closed`/`closed_at` today.
- REST: `ConflictError` in `server/src/lib/api/middleware/apiMiddleware.ts` maps to 409; `ValidationError` to 400. Routes: `server/src/app/api/v1/tickets/[id]/bundle/route.ts` and `.../bundle/children/route.ts`. OpenAPI descriptions in `server/src/lib/api/openapi/routes/workManagementV1.ts` ~L298–304. `server/src/lib/mcp/registry.generated.ts` mentions bundle routes — check how it is generated before editing.
- Activity event constants: `shared/lib/ticketActivity/types.ts` (`REOPENED`, `CLOSED`, `BUNDLE_REOPENED`); timeline labels under `bento.timeline.event.*` in `features/tickets` locale.
- UI kit: `Dialog`/`DialogContent`/`DialogFooter` and `ConfirmationDialog` from `@alga-psa/ui/components`; the list dialog already uses `CustomSelect` + `Checkbox`; the detail panel's multi-client confirm is a `ConfirmationDialog` (`isAddChildMultiClientConfirmOpen`).
- Existing integration suite `server/src/test/integration/ticketBundling.integration.test.ts` (924 lines) has helpers `insertTicket`, `createContact`, `grantUserPermissions`, `loadTicketReferenceData` (gives `statusOpenId`, `statusClosedId`, `boardId`) and mocks the session user via `mockSessionUserId`/`mockCurrentUser`; new cases slot in after the reopen-on-reply test. Board close rules for T008/T012 can be inserted directly into `board_close_rules` for the test board.

## Commands / Runbooks

- Integration tests (needs the test DB from the wired compose project): `cd server && npx vitest run src/test/integration/ticketBundling.integration.test.ts`
- Unit tests in the tickets package: `cd packages/tickets && npx vitest run`
- Dev server for smoke: already running on port 3312 (`PORT=3312 npm run dev`), stack `alga-psa-local-test`.
- Find all attach sites: `grep -rn "master_ticket_id: data.masterTicketId\|master_ticket_id: params.masterTicketId" packages/tickets/src/actions server/src/lib/api/services`

## Links / References

- Ticket: alga-2026-0002507 (PSA development board)
- Related, out of scope: alga-2026-0002357 (child-resolved → parent notification roll-up)
- Close rules PRD: `docs/plans/2026-06-10-ticket-close-rules/PRD.md`
- Key files: `packages/tickets/src/actions/ticketBundleActions.ts`, `packages/tickets/src/actions/ticketBundleUtils.ts`, `packages/tickets/src/actions/optimizedTicketActions.ts`, `packages/tickets/src/lib/validateTicketClosure.ts`, `packages/tickets/src/lib/ticket-columns.tsx`, `packages/tickets/src/components/ticket/TicketDetails.tsx`, `packages/tickets/src/components/TicketingDashboard.tsx`, `server/src/lib/api/services/TicketService.ts`, `server/src/lib/api/controllers/ApiTicketController.ts`, `server/src/lib/api/schemas/ticketBundle.ts`

## Open Questions

- See PRD "Open questions" 1–6; all decided by the XO on 2026-09-18 (see work order "Settled decisions"). No open questions remain.

## Implementation notes (2026-09-18)

- **Pure policy moved out of the `'use server'` file.** `resolveClosedMasterChoices`, `CLOSED_MASTER_CHOICES`, and `BundleConcurrentModificationError` live in `packages/tickets/src/lib/ticketBundlePolicy.ts`. A `'use server'` module may only export async functions; re-exporting a type (`export type { ClosedMasterChoice }`) from `ticketBundleUtils.ts` broke the Turbopack server-action manifest at runtime ("Export ClosedMasterChoice doesn't exist in target module"), so it was removed and importers now pull the type from the policy module directly.
- **One engine, four callers.** `attachChildrenToBundle(trx, tenant, params)` in `ticketBundleUtils.ts` owns invariants, closed-context, choice validation, the guarded link write, `ticket_bundle_settings` upsert, `TICKET_BUNDLE_CHILD_ADDED` activities, and the consequence via `applyClosedMasterChoice`. It returns a discriminated result with stable codes; the actions map codes to `actionError` + i18n keys, `TicketService` maps to `ConflictError`/`ValidationError`/`NotFoundError`. `TICKET_MERGED` and all consequence events ride back as publication descriptors and are registered with `registerAfterCommit` by each caller.
- **Pre-write validation.** `apply_resolution` runs `enforceTicketCloseRules` on every child before the link UPDATE, so a `close_rule_failed` result leaves nothing behind. The concurrency guard still throws `BundleConcurrentModificationError` (rolls the transaction back); actions and the service map it.
- **Child close matches the canonical close.** The `apply_resolution` child UPDATE now also sets `response_state: null` (so an `awaiting_client` child never reloads closed-but-awaiting, which is exactly the mirrored-resolution case); the `CLOSED` activity gains a `response_state` diff only when the value actually changed (read via the child snapshot). It also publishes the resolution SLA stage completion event (`buildTicketResolutionSlaStageCompletionEvent`) as an after-commit publication with its `idempotencyKey` carried through `BundleAfterCommitPublication` and passed to `publishWorkflowEvent` by both callers.
- **Reopen stays master-only.** `reopenBundleMasterOnly` is the extracted primitive; the child-reply path calls it with `BUNDLE_REOPENED` + SYSTEM + `child_reply`, and `reopen_master` calls it with `TICKET_REOPENED` + USER + `add_child`.
- **MCP registry.** `server/src/lib/mcp/registry.generated.ts` is generated by `node ee/scripts/generate-chat-registry.mjs` from the OpenAPI specs in `sdk/docs/openapi/` (`sdk` `openapi:generate` first). Those specs are built from `workManagementV1.ts`. Because the registry's bundle request-body schema is generic (`additionalProperties: {}`), only the route description carries `on_closed_master`; the two bundle descriptions were updated in `workManagement1.ts` and mirrored into the registry by hand rather than running the full spec regeneration.

## Commands that actually worked in this worktree

- Integration tests (the suite DB is a separate `test_database` on the compose Postgres):
  `cd server && DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user DB_PASSWORD_ADMIN="$(cat ../secrets/postgres_password)" DB_PASSWORD_SERVER="$(cat ../secrets/db_password_server)" npx vitest run src/test/integration/ticketBundling.integration.test.ts`
- Unit tests: `cd packages/tickets && npx vitest run` (806 pass).
- Server typecheck needs a large heap: `cd server && NODE_OPTIONS="--max-old-space-size=26624" npx tsc --noEmit -p tsconfig.json`.

## T013 manual smoke (port 3312, worktree-owned dev server)

Verified live against `http://127.0.0.1:3312` (glinda@emeraldcity.oz):
- Closed bundle master detail: the bundle panel renders, the amber "1 open children" badge is shown next to the master banner.
- Add of an open child to the closed master opens "This bundle's master is closed" with `keep_closed` selected by default, `apply_resolution` helper correctly saying the master has no public resolution comment to post, and the gating line absent (board rule off).
- Confirming `keep_closed` linked the child; the master stayed closed, the child stayed open, and the badge updated to "2 open children".
- Closing the children and reloading hid the badge.
- Not clicked through live: the ticket-list bulk dialog's embedded choice group (same shared `ClosedMasterChoiceFields` component and same `getBundleMasterClosedContextAction` used by the verified detail dialog) and the list-row badge (covered at the query level by T011). The runtime Turbopack export bug above was found during this smoke and fixed.

