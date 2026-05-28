# Scratchpad — Board-level live ticket timer toggle

- Plan slug: `ticket-board-live-timer-toggle`
- Created: `2026-03-29`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-29) Scope is a board-level boolean for live ticket timer enablement, not a user preference or per-ticket toggle. Rationale: simpler MSP admin mental model and lower-risk v1.
- (2026-03-29) Disabling the board setting hides only the live timer and tracked intervals. Manual time entry remains available.
- (2026-03-29) Board change behavior should apply immediately after a successful save in the current ticket details view.

## Discoveries / Constraints

- (2026-03-29) [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx) owns timer lifecycle, lock replacement, and auto-start gating through `useTicketTimeTracking`.
- (2026-03-29) Tracked intervals are rendered in [`TicketProperties.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketProperties.tsx), not directly in `TicketDetails.tsx`.
- (2026-03-29) Boards settings save flows currently pass board fields through `createBoard` and `updateBoard` in [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx:516).
- (2026-03-29) Shared board typing currently lives in [`packages/types/src/interfaces/board.interface.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/types/src/interfaces/board.interface.ts).

## Commands / Runbooks

- (2026-03-29) Inspect ticket timer lifecycle: `rg -n "useTicketTimeTracking|renderIntervalManagement|autoStart" packages/tickets packages/ui`
- (2026-03-29) Inspect board settings save path: `sed -n '500,560p' server/src/components/settings/general/BoardsSettings.tsx`
- (2026-03-29) Validate plan JSON files: `node -e "JSON.parse(require('fs').readFileSync('docs/plans/2026-03-29-ticket-board-live-timer-toggle/features.json','utf8')); JSON.parse(require('fs').readFileSync('docs/plans/2026-03-29-ticket-board-live-timer-toggle/tests.json','utf8')); console.log('json ok')"`

## Links / References

- [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx)
- [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx)
- [`TicketProperties.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketProperties.tsx)
- [`board.interface.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/types/src/interfaces/board.interface.ts)

## Open Questions

- Whether a future v2 should evolve the boolean into richer per-board timer modes.

## Implementation Log

- (2026-03-29) Completed `F001` via migration [`20260329120000_add_enable_live_ticket_timer_to_boards.cjs`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/migrations/20260329120000_add_enable_live_ticket_timer_to_boards.cjs) to add `boards.enable_live_ticket_timer`, backfill existing rows to `true`, and enforce non-null + default semantics.
- (2026-03-29) Completed `F002` by extending shared board typings in [`packages/types/src/interfaces/board.interface.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/types/src/interfaces/board.interface.ts) and [`server/src/interfaces/board.interface.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/interfaces/board.interface.ts).
- (2026-03-29) Completed `F003` by adding `Enable live ticket timer` toggle UI + helper copy in Board Configuration for both create and edit flows in [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx).
- (2026-03-29) Completed `F004` by persisting `enable_live_ticket_timer` through board create/update payloads in [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx) and [`boardActions.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/actions/board-actions/boardActions.ts).
- (2026-03-29) Completed `F005` with enabled fallback semantics (`null`/`undefined` => `true`) in board read surfaces via normalization in [`boardActions.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/actions/board-actions/boardActions.ts).
- (2026-03-29) Completed `F006` by ensuring ticket board metadata includes the new field for both initial and refreshed board state in [`optimizedTicketActions.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/actions/optimizedTicketActions.ts) and board refresh in [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx).
- (2026-03-29) Completed `F007`/`F008` by deriving board timer policy in [`boardLiveTicketTimer.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/lib/boardLiveTicketTimer.ts), gating auto-start and timer presentation in [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx).
- (2026-03-29) Completed `F009`/`F010` by hiding tracked intervals and live timer controls when disabled while preserving `Add Time Entry` in [`TicketProperties.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketProperties.tsx).
- (2026-03-29) Completed `F011` by refreshing board metadata after board changes and enforcing immediate in-view timer shutdown/reset when destination board disables live timing in [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx).

## Test Coverage Added

- (2026-03-29) Completed `T001` with DB-backed integration coverage in [`boardLiveTicketTimerSetting.integration.test.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/test/integration/boardLiveTicketTimerSetting.integration.test.ts) for default-enabled create semantics and explicit disable/readback behavior.
- (2026-03-29) Completed `T002` in [`BoardsSettings.copyStatuses.test.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.copyStatuses.test.tsx) to assert create/edit toggle rendering and save payload inclusion.
- (2026-03-29) Completed `T003`/`T005` contract coverage in [`TicketDetails.liveTimerPolicy.contract.test.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.contract.test.ts) for auto-start gating and immediate stop/reset policy wiring.
- (2026-03-29) Completed `T004`/`T006` UI coverage in [`TicketProperties.liveTimerPolicy.test.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx) for disabled/ enabled rendering behavior.

## Verification Commands

- (2026-03-29) `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.contract.test.ts src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx`
- (2026-03-29) `cd server && npx vitest run src/components/settings/general/BoardsSettings.copyStatuses.test.tsx src/test/integration/boardLiveTicketTimerSetting.integration.test.ts`
