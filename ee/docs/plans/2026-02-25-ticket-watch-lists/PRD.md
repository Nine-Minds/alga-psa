# PRD — Ticket Watch Lists and CC-Style Notifications

- Slug: `ticket-watch-lists`
- Date: `2026-02-25`
- Status: Draft

## Summary
Add a ticket-level Watch List so teams can include additional recipients (including technicians) on customer-visible ticket notifications. Watchers are managed on the ticket, auto-populated from inbound email `To`/`CC`, and notified via separate individual emails (not CC headers).

## Problem
Current ticket notification behavior primarily targets the ticket contact/client plus internal assignment/resource recipients. Customers and internal stakeholders often need extra ad-hoc visibility for a specific ticket thread. Without a Watch List:
- Teams manually forward updates.
- Inbound email context (`To`/`CC`) is lost after ingestion.
- Visibility is inconsistent across customer-visible ticket updates.

## Goals
1. Provide a per-ticket Watch List that can include any email address (techs included).
2. Auto-add inbound email `To`/`CC` recipients to Watch List during ingestion.
3. Let users uncheck/remove Watch List recipients from the ticket UI.
4. Send Watch List notifications only for customer-visible ticket updates.
5. Send Watch List recipients as separate individual emails.

## Non-goals
- Global watcher templates/distribution lists across all tickets.
- Changing existing notification preference architecture for non-watch-list recipients.
- Replacing core recipient logic (contact/client/assigned/resource); Watch List is additive.
- Introducing SMS/push channels.

## Users and Primary Flows
- Dispatcher / coordinator:
  - Adds or removes watcher emails on a ticket.
  - Expects watchers to receive customer-visible updates going forward.
- Technician / internal stakeholder:
  - Can be added as watcher by email.
  - Receives same customer-visible updates as other watchers.
- Inbound email flow:
  - Incoming message creates/replies on a ticket.
  - Recipients in `To`/`CC` are merged into ticket Watch List automatically.

## UX / UI Notes
- Add a `Watch List` section on ticket details (properties panel).
- UI elements:
  - Email input + `Add` action.
  - List of watcher entries with checkbox (`active`) and remove action.
- Checkbox behavior:
  - Checked: watcher receives notifications.
  - Unchecked: watcher remains listed but inactive (no notifications).
- Clarified customer choice: notifications to watchers are separate individual sends, not a single email with CC recipients.

## Requirements

### Functional Requirements
- FR-01: Ticket attributes include a Watch List array of recipients with at least email + active state.
- FR-02: Manual add validates/normalizes email and prevents duplicate active entries by normalized email.
- FR-03: Manual remove deletes the watcher entry from the ticket.
- FR-04: Manual uncheck toggles watcher to inactive without deleting required history fields.
- FR-05: Inbound email ingestion collects `To` + `CC` recipients and merges them into Watch List.
- FR-06: Inbound merge excludes sender and provider mailbox address to avoid self-watch loops.
- FR-07: Inbound merge reactivates an existing inactive watcher when that email appears again in `To`/`CC`.
- FR-08: Watchers receive notifications for customer-visible ticket events:
  - ticket created
  - ticket updated
  - ticket assigned (customer-visible notification path)
  - ticket comment added (public/customer-visible comments only)
  - ticket closed
- FR-09: Watcher notifications are sent as individual emails (one watcher per send).
- FR-10: Watcher recipients are deduped against existing recipients per event.
- FR-11: Public comment watcher notifications must not notify the comment author.
- FR-12: Existing recipient behavior (contact/client/assigned/additional resources) remains unchanged except dedupe where applicable.

### Non-functional Requirements
- NFR-01: No schema migration required for v1 (use `ticket.attributes.watch_list`).
- NFR-02: Behavior must be backward-compatible for tickets with null/legacy attributes.
- NFR-03: Errors in watch-list enrichment should not break inbound email ticket/comment creation.

## Data / API / Integrations
- Storage target:
  - `tickets.attributes.watch_list` (JSON array).
- Suggested entry shape:
  - `email: string` (normalized lowercase)
  - `active: boolean`
  - optional metadata: `name`, `source` (`manual|inbound_to|inbound_cc`), timestamps.
- Inbound integration:
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts`
- Outbound integration:
  - `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
- UI integration:
  - `packages/tickets/src/components/ticket/TicketProperties.tsx`
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`

## Security / Permissions
- Watch List edits follow existing ticket update permissions.
- No privileged bypass: only authorized ticket editors can modify watchers.
- Email validation/sanitization required for manual entry and inbound ingestion.

## Observability
- Use existing notification logs and email send instrumentation.
- Errors in watcher merge/send should include ticketId/tenantId/recipient context in existing logger paths.

## Rollout / Migration
- v1 rollout can be immediate without migration because data is in ticket attributes.
- Existing tickets start with empty Watch List unless updated manually or by inbound email processing.

## Open Questions
1. Should inactive watchers remain visible indefinitely or be auto-pruned after a period?
2. Should Watch List edits themselves generate an audit event/comment in the ticket timeline?
3. Should watcher sends respect internal user notification preference toggles when watcher email matches an internal user?

## Acceptance Criteria (Definition of Done)
1. Users can add, uncheck, and remove watcher emails on a ticket.
2. Inbound email processing auto-adds `To`/`CC` recipients to Watch List, excluding sender/provider mailbox.
3. Active watchers receive customer-visible ticket updates via separate individual emails.
4. Public comment notifications do not email the comment author.
5. Duplicate emails are not sent to the same address for a single event.
6. Existing non-watcher recipients continue to receive expected notifications.
7. Automated tests cover watch-list parsing/merge logic, inbound recipient enrichment, and outbound watcher fan-out per event path.
