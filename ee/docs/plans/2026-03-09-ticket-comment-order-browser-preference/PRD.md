# PRD — Ticket comment order browser preference

- Slug: `ticket-comment-order-browser-preference`
- Date: `2026-03-09`
- Status: Implemented

## Summary
Persist each browser's ticket conversation comment-order choice so users do not need to re-select newest-first or oldest-first on each ticket view.

## Problem
`TicketConversation` currently resets comment ordering based on the incoming `defaultNewestFirst` prop each time the component mounts. Users can flip the order within a ticket, but that choice is not remembered for later tickets in the same browser session or future visits.

## Goals
- Remember the user's ticket comment order choice per browser.
- Keep `defaultNewestFirst` as the fallback when the browser has no saved preference yet.
- Update the saved preference silently whenever the user changes the order toggle.

## Non-goals
- Cross-browser or cross-device sync.
- New backend APIs, database changes, or server-side preference persistence.
- Any UI changes beyond keeping the existing toggle behavior and labels.

## Users and Primary Flows
- MSP ticket users open a ticket conversation and see comments in their preferred order if they have chosen one before in this browser.
- A first-time user with no saved browser preference continues to see the order implied by `defaultNewestFirst`.
- When a user flips the existing newest/oldest order control, subsequent ticket conversations in the same browser use the new choice automatically.

## UX / UI Notes
- Reuse the existing order toggle in `packages/tickets/src/components/ticket/TicketConversation.tsx`.
- Do not add confirmation, toast, or settings UI for this preference.
- The behavior should feel silent and immediate.

## Requirements

### Functional Requirements
- On initial render, `TicketConversation` must check for a stored browser preference for comment order.
- If a stored browser preference exists, it must override `defaultNewestFirst`.
- If no stored browser preference exists, the component must initialize from `defaultNewestFirst`.
- When the user toggles the comment order, the component must update both the rendered order and the stored browser preference.
- The same stored preference must apply to standard conversation comments and external comments because both are driven by the same order control.

### Non-functional Requirements
- Storage access must be safe in environments where `window` or `localStorage` is unavailable.
- Invalid stored values must not break rendering and should fall back to `defaultNewestFirst`.
- The change should remain isolated to ticket conversation UI code and avoid unnecessary rerenders or backend dependencies.

## Data / API / Integrations
- Use browser `localStorage` only.
- No server actions or API routes are required.

## Security / Permissions
- No permission changes.
- Only a non-sensitive boolean UI preference is stored in the browser.

## Observability
- No new telemetry or logging is required.

## Rollout / Migration
- No migration is required.
- Existing users without a stored browser value continue to use `defaultNewestFirst` until they change the toggle.

## Open Questions
- None.

## Acceptance Criteria (Definition of Done)
- A user with no stored browser preference sees comment order based on `defaultNewestFirst`.
- A stored browser preference overrides `defaultNewestFirst` on subsequent renders.
- Changing the newest/oldest toggle updates the stored browser preference silently.
- Automated tests cover fallback behavior, stored override behavior, and persistence on toggle.
