# Scratchpad — Ticket bundles: warn before sync-mode master status change closes/reopens children

- Plan slug: `ticket-bundle-sync-status-propagation-warning`
- Created: `2026-09-18`
- Ticket: alga-2026-0002508 (related alga-2026-0002507, alga-2026-0002509)

## What This Is

Rolling notes for the effort. Short bullets; update earlier entries when a decision changes.

## Decisions

- (2026-09-18) Confirmation is a **server** contract, not a UI-only pre-check: `updateTicketInTransaction` throws `BundlePropagationConfirmationRequiredError` when a boundary-crossing sync-master change arrives without `propagateToChildren`. Web pre-checks via a preview action to avoid the round-trip; mobile and API consumers use the 409 itself as the preflight. Every surface therefore gets parity for free.
- (2026-09-18) Propagation record is a **table** (`ticket_bundle_status_propagations`), not a column on `tickets`: it records who/when/previous status, supports revert history, and cascades on ticket delete. A `tickets` column would need clearing logic in every child-removal path.
- (2026-09-18) On a propagated close, children that are **already closed are skipped** (their `closed_at/closed_by` are their own). Reopen only touches children with an active propagation row. This is what makes "independently closed stays closed" hold.
- (2026-09-18) `propagateToChildren: false` suppresses the whole child write for that update (including any priority/assignee change bundled into the same request). Simplest mental model; revisit if operators object (PRD OQ3).
- (2026-09-18) Extract the child propagation block into `propagateBundleMasterStatus` in `ticketBundleUtils.ts` and call it from both `updateTicketInTransaction` and `TicketService.update`/`updateStatus`. The REST path currently has **no** propagation at all; unifying is the only way to get parity without re-deriving the logic. Candidate `// LEVERAGE: pattern close-denormalization` already noted in TicketService.ts:1856 — the same extraction could later absorb it.
- (2026-09-18) No backfill for existing bundles: first reopen after deploy reopens nothing via propagation (safe direction).

## Discoveries / Constraints

- (2026-09-18) Propagation lives in `updateTicketInTransaction` (`packages/tickets/src/actions/optimizedTicketActions.ts` ~L3076–3131), not `updateTicketWithCache` (thin auth wrapper ~L3142). Fields: `status_id, assigned_to, priority_id, closed_by, closed_at` — **`is_closed` is missing**, so children's denormalized column goes stale. Child selection is a flat `where({ master_ticket_id })`, no status filter.
- (2026-09-18) Child write-lock (`status_id, assigned_to, priority_id`) is at ~L2497–2506 of the same function and only applies to the server-action path; `TicketService.update` has neither the lock nor propagation.
- (2026-09-18) "Closed" = `statuses.is_closed`; no shared `isClosedStatus` helper. Denormalized `tickets.is_closed` is maintained in three duplicated places (optimizedTicketActions ~L2594, TicketService ~L1788, ticketBundleUtils reopen ~L92).
- (2026-09-18) Master-only write precedent: `maybeReopenBundleMasterFromChildReply` (`ticketBundleUtils.ts` L38–131) updates the master row directly by `ticket_id`, bypassing `updateTicketInTransaction`. A contract test (`ticketSupportFacade.contract.test.ts:77-79`) pins its SQL shape — keep those strings when editing the file.
- (2026-09-18) Detail page close-rules pre-check is repeated at four sites in `TicketDetails.tsx`: `handleSelectChange` ~L1764, resolution-comment close ~L2065, `handleBatchSaveChanges` ~L2661, `handleResolveAndClose` ~L2752. The propagation confirmation must cover all four → extract `confirmStatusChange`.
- (2026-09-18) Bulk status: `bulkUpdateTicketStatus` (`ticketActions.ts:2049`) loops `updateTicketInTransaction` per ticket; UI is `BulkChangeStatusDialog.tsx` mounted by `server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx` (route `/msp/tickets/bulk-status`; wiring pinned by `ticketsModalRoutes.contract.test.ts`).
- (2026-09-18) Mobile (`ee/mobile`) uses `PUT /api/v1/tickets/{id}/status` (`src/api/tickets.ts:284`); the only confirm is `StatusPickerModal.tsx:108` native Alert on `is_closed`.
- (2026-09-18) Bundle dialog is inline in `TicketingDashboard.tsx` (~L2900–2946); copy keys `bulk.bundle.syncUpdates(Help)`, `bulk.bundleSyncUpdates(Help)`, and master-panel `details.bundle.childrenDescription` in `server/public/locales/*/features/tickets.json` (six locales).
- (2026-09-18) API: route `server/src/app/api/v1/tickets/[id]/route.ts` → `ApiTicketController.update` (~L1875) → `TicketService.update` (~L1716). Zod `updateTicketSchema` at `server/src/lib/api/schemas/ticket.ts:135`. `ConflictError` (409) in `apiMiddleware.ts:93`; ticket-domain 409 codes at ~L228. OpenAPI body `WorkV1TicketUpdateBody` at `openapi/routes/workManagementV1.ts:100`; regenerate `server/src/lib/mcp/registry.generated.ts` and `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- (2026-09-18) Schema: only `tickets.master_ticket_id`, `ticket_bundle_settings`, `ticket_bundle_mirrors` (migration `20260104120000_create_ticket_bundles.cjs`). No members table, no propagation table. New tenant tables must be listed in `server/migrations/utils/tenantDb.cjs` (~L479).
- (2026-09-18) `git log --all --grep=3363` → nothing; no `co-managed`/`coManaged` in source. The "PR #3363 reworks propagation per child" note from the ticket has no counterpart in this tree — treat as unverified.
- (2026-09-18) `bundleTicketsAction` (L181–189) explicitly does not touch child status → "children closed at bundle time" is unreproduced on `main`.

## Commands / Runbooks

- Integration test: `cd server && npx vitest run src/test/integration/ticketBundling.integration.test.ts` (needs test DB per `test-utils/dbConfig`; `beforeAll` has a 180s timeout).
- Existing sync test to extend: `ticketBundling.integration.test.ts` L426 `'sync_updates propagates workflow changes; children lock workflow fields'` — uses only open children; add closed-child fixtures via `insertTicket(..., { statusId: statusClosedId })` as at L315.
- Dev server for this card: port 3915, compose project `alga-psa-local-test`.

## Links / References

- Ticket alga-2026-0002508 (spec in internal comment); related alga-2026-0002507, alga-2026-0002509.
- Key files: `packages/tickets/src/actions/optimizedTicketActions.ts`, `packages/tickets/src/actions/ticketBundleUtils.ts`, `packages/tickets/src/actions/ticketBundleActions.ts`, `packages/tickets/src/actions/ticketActions.ts`, `packages/tickets/src/components/ticket/TicketDetails.tsx`, `packages/tickets/src/components/BulkChangeStatusDialog.tsx`, `packages/tickets/src/components/TicketingDashboard.tsx`, `server/src/lib/api/services/TicketService.ts`, `server/src/lib/api/controllers/ApiTicketController.ts`, `server/src/lib/api/schemas/ticket.ts`, `server/src/lib/api/middleware/apiMiddleware.ts`, `ee/mobile/src/features/ticketDetail/components/StatusPickerModal.tsx`.

## Open Questions

- See PRD "Open Questions" (bundle-time child close repro; close rules on children; master-only scope for non-status fields; bulk single vs per-master choice; reopen target status).
