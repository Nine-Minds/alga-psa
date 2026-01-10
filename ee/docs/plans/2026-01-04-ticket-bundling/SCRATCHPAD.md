# Scratchpad — Ticket Bundling

## Links / Context

- Mockup: merge/bundle modal + ticket list bundling toggle (provided in prompt)
- Architecture overview: `docs/architecture/overview.md`
- Ticket UI: `server/src/components/tickets/TicketingDashboardContainer.tsx`, `server/src/components/tickets/ticket/TicketDetails.tsx`
- Ticket model: `server/src/lib/models/ticket.tsx`
- Notification system: `server/src/lib/notifications/email.ts`

## Working Notes

- Existing UI mock uses “Merge Tickets” language and includes a checkbox to “Link Child Tickets to Master & Sync Updates” — plan treats this as a mode selector with sensible defaults and tenant policy overrides.
- Proposed schema for MVP keeps bundling simple via `tickets.master_ticket_id` + `ticket_bundle_settings` keyed by master ticket to store bundle-level behavior.

## Decisions (Draft)

- Prefer “bundle” semantics over destructive merges: child tickets remain addressable and retain source/requester context.
- UI terminology: **Bundle**.
- Default mode: **sync_updates**.
- Child workflow fields (status/assignment/priority): **locked by default**.
- Default customer notification scope for master public updates: **all child requesters**.
- Bundle membership: allow cross-client bundling within a tenant (e.g., outage bundles); UI should warn/indicate “multiple clients”.
- Inbound child replies surface on master as **view-only** (aggregated), not duplicated onto the master ticket.
- Sync updates do **not** include internal notes (internal notes stay on master).
- On bundle creation, children keep their current status; workflow fields are locked by default.
- De-duplicate internal notifications: notify on master event, not on each mirrored child event.

## Open Questions (Needs Answers)

- Should “reopen on reply” reopen only the master or also the child ticket(s)?
- For cross-client bundles, should “Email all affected requesters” require an extra confirmation step by default?

## Commands

- Validate plan JSON: `python scripts/validate_plan.py ee/docs/plans/2026-01-04-ticket-bundling`
