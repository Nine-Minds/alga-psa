# PRD — Board-level live ticket timer toggle

- Slug: `ticket-board-live-timer-toggle`
- Date: `2026-03-29`
- Status: Draft

## Summary

Add a board-level setting that lets MSP admins disable the live ticket timer experience for specific boards while keeping manual time entry available. When disabled for a board, the ticket details screen must stop showing the live timer and tracked interval UI, skip auto-start behavior, and react immediately when a ticket is saved onto a board with a different setting.

## Problem

Users have reported that the live time-tracking experience on the ticket details screen is not appropriate for every workflow. In the current implementation, the ticket screen mounts timer lifecycle behavior and tracked interval UI whenever the ticket details view is open, which creates noise for boards where technicians do not want live timing on tickets.

This is especially problematic in an MSP PSA where boards often represent materially different workflows. Some boards are heavily time-driven and billing-oriented, while others are primarily intake, triage, coordination, or exception handling. The product currently lacks a board-scoped way to express that difference.

## Goals

- Allow admins to enable or disable the live ticket timer per board.
- Keep the control in board settings, where admins already manage board behavior.
- Preserve existing behavior by default for existing boards and new boards unless an admin opts out.
- Hide only the live timer and tracked interval UI when disabled.
- Prevent live timer auto-start when the board setting is disabled.
- Re-evaluate the rule immediately after a ticket board change is saved.

## Non-goals

- Do not add user-level timer visibility preferences in this change.
- Do not change manual time entry creation behavior.
- Do not redesign the ticket status editor UI in board settings.
- Do not introduce a richer timer mode model (`off/manual/auto-start`) in v1.
- Do not alter unrelated time-tracking surfaces outside ticket details.

## Users and Primary Flows

- MSP admin opens board settings, creates or edits a board, and toggles `Enable live ticket timer`.
- Technician opens a ticket on a board with the setting enabled and sees the current timer and tracked interval experience.
- Technician opens a ticket on a board with the setting disabled and does not see the live timer or tracked intervals.
- Technician changes a ticket from one board to another, saves the change, and sees the timer experience update immediately to reflect the destination board policy.

## UX / UI Notes

- Add a boolean board setting in [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx) in the existing `Board Configuration` section.
- Recommended label: `Enable live ticket timer`
- Recommended helper copy: `Shows the live timer and tracked intervals on tickets in this board. Manual time entry remains available.`
- Do not change the ticket-status row controls in the board settings form.
- On ticket details, when the setting is disabled:
  - hide live timer controls
  - hide tracked intervals
  - skip live timer auto-start
- `Add Time Entry` remains available.

## Requirements

### Functional Requirements

1. Board data supports a persisted boolean field for live ticket timer enablement.
2. Existing boards behave as enabled after rollout unless explicitly changed by an admin.
3. New boards default to enabled.
4. Board create and update flows save the field.
5. Board read flows return the field anywhere ticket details depend on board metadata.
6. Ticket details derive live timer visibility from the current board setting.
7. Ticket details do not start or continue live tracking when the current board disables it.
8. Tracked intervals are hidden when the current board disables live timing.
9. Manual time entry remains accessible even when live timing is disabled.
10. Saving a ticket onto a different board causes immediate re-evaluation of the rule in the current view.
11. If a ticket is moved to a board with live timing disabled while a timer is active in the current view, the UI stops live tracking and clears timer state in that view.

### Non-functional Requirements

- The change must preserve current behavior for tenants who do not modify board settings.
- The board setting must not introduce noisy UI churn in board settings.
- The implementation should keep the rule centralized enough that ticket details and interval rendering cannot drift apart.
- Tests should be behavioral and focused on high-signal coverage for persistence, gating, and board-change transitions.

## Data / API / Integrations

- Add a new persisted board attribute, tentatively named `enable_live_ticket_timer`.
- Extend the shared board interface in [`packages/types/src/interfaces/board.interface.ts`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/types/src/interfaces/board.interface.ts).
- Extend the board settings form state, create flow, and update flow in [`BoardsSettings.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/server/src/components/settings/general/BoardsSettings.tsx).
- Ensure ticket details board payloads already flowing through `initialBoard` include the new field, including the ticket details container and any board lookup paths used after board changes.
- Gate the live timer lifecycle in [`TicketDetails.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketDetails.tsx).
- Gate tracked interval rendering in [`TicketProperties.tsx`](/Users/roberisaacs/alga-psa.worktrees/feature/time-entry-counter-auto-start-toggle/packages/tickets/src/components/ticket/TicketProperties.tsx).

## Security / Permissions

- Reuse existing board settings permissions for modifying the new board field.
- Reuse existing ticket read/update permissions; the new field should not create a new privilege boundary.
- No new tenant-crossing behavior is introduced.

## Observability

- No new telemetry or rollout instrumentation is planned for v1.
- Existing timer analytics and logging should naturally reflect reduced usage on boards where the feature is disabled.

## Rollout / Migration

- Add a schema change that introduces `enable_live_ticket_timer` with enabled semantics by default.
- Backfill existing rows to enabled semantics, or treat null/missing values as enabled until all rows are migrated.
- Ship the board setting UI and ticket gating together so admins can immediately control behavior.

## Open Questions

- Whether a future v2 should expand the boolean into a richer mode such as `off/manual/auto-start`.
- Whether the boards list should eventually show a read-only indicator for the setting.

## Acceptance Criteria (Definition of Done)

- Admins can create or edit a board and save a board-level live ticket timer toggle.
- Existing boards continue to show the live timer unless an admin disables it.
- Tickets on disabled boards do not show the live timer controls.
- Tickets on disabled boards do not show tracked intervals.
- Tickets on disabled boards do not auto-start live timing.
- Manual time entry remains available on disabled boards.
- Saving a board change on a ticket re-evaluates the destination board setting immediately.
- Moving a ticket to a disabled board stops and hides the live timer in the current view after save.
- Automated tests cover persistence, gating, and saved board-change behavior.
