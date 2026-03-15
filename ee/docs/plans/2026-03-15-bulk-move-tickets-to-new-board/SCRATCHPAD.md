# Scratchpad — Bulk move tickets to a new board

- Plan slug: `bulk-move-tickets-to-new-board`
- Created: `2026-03-15`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-15) Bulk move will use partial-success reporting identical in spirit to bulk delete so one invalid ticket does not block the entire selection.
- (2026-03-15) Destination statuses in the dialog must be limited to statuses valid for the selected destination board, and the board's default status will be preselected.
- (2026-03-15) Moving a ticket to a new board must clear `category_id` and `subcategory_id` to match existing single-ticket board-change behavior.
- (2026-03-15) The dependency branch `feature/board-specific-statuses` was merged before planning so this work is based on board-owned ticket statuses.

## Discoveries / Constraints

- (2026-03-15) Existing bulk ticket actions live in `packages/tickets/src/components/TicketingDashboard.tsx`; bulk delete already has the desired partial-success UX shape.
- (2026-03-15) Existing dashboard selection is page-based. This plan assumes bulk move acts on the currently selected tickets without changing selection semantics.
- (2026-03-15) `feature/board-specific-statuses` changed status ownership, validation, APIs, migrations, and ticket UI behavior; bulk move should reuse that validation rather than invent its own board/status rules.
- (2026-03-15) Likely server-side implementation points are `packages/tickets/src/actions/ticketActions.ts` and/or `packages/tickets/src/actions/optimizedTicketActions.ts`, depending on which path best preserves existing ticket update semantics.

## Commands / Runbooks

- (2026-03-15) Merge dependency branch: `git merge feature/board-specific-statuses`
- (2026-03-15) Scaffold ALGA plan: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Bulk move tickets to a new board" --slug bulk-move-tickets-to-new-board`
- (2026-03-15) Relevant dashboard bulk-action source: `packages/tickets/src/components/TicketingDashboard.tsx`
- (2026-03-15) Relevant ticket action source: `packages/tickets/src/actions/ticketActions.ts`

## Links / References

- PRD: `ee/docs/plans/2026-03-15-bulk-move-tickets-to-new-board/PRD.md`
- Bulk dashboard UI: `packages/tickets/src/components/TicketingDashboard.tsx`
- Ticket action layer: `packages/tickets/src/actions/ticketActions.ts`
- Optimized ticket update path: `packages/tickets/src/actions/optimizedTicketActions.ts`
- Ticket detail board/status behavior: `packages/tickets/src/components/ticket/TicketInfo.tsx`
- Board-scoped status branch artifacts now merged into this branch.

## Open Questions

- None currently.

## Iteration Notes

- (2026-03-15) Completed `Move to Board` header action visibility gating so bulk move is rendered only when `hasSelection && canUpdateTickets`.
- (2026-03-15) Completed bulk-move dialog integration in `TicketingDashboard.tsx`:
  - Destination board/status loading and default preselect logic.
  - Confirm handler with per-ticket partial-success handling and refresh/selection behavior.
  - Close handler/state reset behavior.
- (2026-03-15) Added `moveTicketsToBoard` action coverage in `packages/tickets/src/actions/ticketActions.moveToBoard.test.ts` for default status, override status, invalid status rejection, partial success, and permission failure behavior.
- (2026-03-15) Added component contract coverage in `packages/tickets/src/components/TicketingDashboard.moveBulk.contract.test.ts` for all bulk move UI acceptance points plus non-regression bulk-delete checks.
- (2026-03-15) Marked all plan `features.json` and `tests.json` items as implemented and prepared for checkpoint commit.
