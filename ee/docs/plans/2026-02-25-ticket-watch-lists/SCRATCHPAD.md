# Scratchpad — Ticket Watch Lists and CC-Style Notifications

- Plan slug: `ticket-watch-lists`
- Created: `2026-02-25`

## What This Is
Working notes for the ticket watch-list feature plan. This log captures clarified scope, discovered code touchpoints, and validation commands.

## Decisions
- (2026-02-25) Delivery mode for watcher notifications is **separate individual emails** (not CC header batching).
- (2026-02-25) Watchers are notified for **customer-visible** ticket updates only.
- (2026-02-25) Initial persistence strategy is `tickets.attributes.watch_list` (no schema migration in v1).
- (2026-02-25) Inbound email ingestion auto-adds `To`/`CC` recipients to watch list; users can uncheck/remove afterward.

## Discoveries / Constraints
- (2026-02-25) Existing ticket notification fan-out is centralized in `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` across created/updated/assigned/comment/closed handlers.
- (2026-02-25) Inbound processing path is `shared/services/email/processInboundEmailInApp.ts` and already includes inbound `to` metadata in comment payloads.
- (2026-02-25) Shared workflow actions (`shared/workflow/actions/emailWorkflowActions.ts`) are the right boundary for DB-backed helper actions used by inbound processing.
- (2026-02-25) Ticket UI/property editing surfaces already use attribute updates via `updateTicketWithCache`, so watch-list UI can piggyback on existing ticket update permissions.
- (2026-02-25) Must avoid adding provider mailbox/self addresses as watchers to reduce self-notification loop risk.

## Commands / Runbooks
- (2026-02-25) Scaffold plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Ticket Watch Lists and CC-Style Notifications" --slug ticket-watch-lists`
- (2026-02-25) Validate plan artifacts:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-25-ticket-watch-lists`
- (2026-02-25) Useful discovery commands:
  - `rg -n "ticketEmailSubscriber|processInboundEmailInApp|updateTicketWithCache" packages server shared -S`
  - `sed -n '1,260p' server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
  - `sed -n '1,320p' shared/services/email/processInboundEmailInApp.ts`

## Links / References
- Customer requirement summary (captured in chat):
  - ServiceNow-style watch list, auto-add from inbound `To/CC`, uncheck/remove from ticket.
- Key implementation files:
  - `packages/tickets/src/components/ticket/TicketProperties.tsx`
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts`
  - `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`

## Open Questions
- Should watcher sends respect internal user-level notification preferences if watcher email maps to an internal user?
- Should watch-list add/remove/toggle actions be surfaced in ticket comment/activity history?
- Should bundle-child fan-out explicitly include watcher behavior or rely strictly on per-ticket event scope?
- (2026-02-25) Implemented F001 by introducing shared watch-list utilities and contract (`shared/lib/tickets/watchList.ts`) with normalized lowercase `email` + `active` booleans persisted in `tickets.attributes.watch_list`.
- (2026-02-25) Implemented F002: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F003: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F004: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F005: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F006: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F007: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F008: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F009: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F010: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F011: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F012: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F013: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F014: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F015: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F016: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F017: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F018: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F019: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F020: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F021: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F022: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F023: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented F024: completed planned scope for this feature item in the ticket watch-list delivery.
- (2026-02-25) Implemented T01: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T02: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T03: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T04: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T05: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T06: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T07: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T08: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T09: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T10: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T11: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T12: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T13: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T14: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T15: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T16: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T17: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T18: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T19: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T20: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T21: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T22: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T23: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T24: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T25: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T26: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T27: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T28: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T29: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T30: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T31: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T32: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T33: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T34: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T35: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T36: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T37: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T38: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T39: added or updated automated coverage for this planned test scenario during watch-list delivery.
- (2026-02-25) Implemented T40: added or updated automated coverage for this planned test scenario during watch-list delivery.
