# Scratchpad — Ticket Response State Tracking

- Plan slug: `ticket-response-state-tracking`
- Created: `2026-01-04`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-01-04) **Data model**: Use separate `response_state` field on tickets (not status metadata). Rationale: "who needs to respond" is orthogonal to "workflow stage" - encoding both in status would cause proliferation.
- (2026-01-04) **Update behavior**: Automatic updates on comment creation based on author_type. No opt-in checkbox needed.
- (2026-01-04) **Client visibility**: Response state visible to clients in client portal with friendly wording ("Awaiting Your Response" / "Awaiting Support Response").
- (2026-01-04) **UI display**: Badge on status pill + new filter dropdown. No separate column.
- (2026-01-04) **Manual override**: Staff can manually set response state via dropdown/button on ticket detail view.
- (2026-01-04) **On close behavior**: Clear response_state to null when ticket is closed.
- (2026-01-04) **Workflow integration**: Add `TICKET_RESPONSE_STATE_CHANGED` event for Automation Hub triggers.

## Discoveries / Constraints

- (2026-01-04) **Status system**: Statuses table has `is_closed` boolean but no other behavioral flags. Statuses are tenant-configurable with `name`, `color`, `icon`, `order_number`, `is_default`.
- (2026-01-04) **Comment author tracking**: Comments already have `author_type` enum (`'internal' | 'client' | 'unknown'`) and `is_internal` boolean. This gives us the data needed to infer response direction.
- (2026-01-04) **Event system**: `TICKET_COMMENT_ADDED` event fires on comment creation with `tenantId`, `ticketId`, `userId`, and comment object (includes `isInternal`). Does NOT currently include `author_type` in payload - needs enhancement.
- (2026-01-04) **Workflow triggers**: Existing `WorkflowTriggerModel` infrastructure supports event-based automation. Can register new event type.
- (2026-01-04) **Multi-tenancy**: All tables use (tenant, entity_id) composite keys. Response state field and events must respect tenant isolation.

## Key File Paths

- **Ticket model**: `server/src/interfaces/ticket.interfaces.tsx`
- **Status interface**: `server/src/interfaces/status.interface.ts`
- **Comment interface**: `server/src/interfaces/comment.interface.ts`
- **Event definitions**: `server/src/lib/eventBus/events.ts`
- **Ticket actions**: `server/src/lib/actions/ticket-actions/ticketActions.ts`
- **Comment actions**: `server/src/lib/actions/commentActions.ts` (likely location)
- **Initial schema**: `server/migrations/202409071803_initial_schema.cjs`
- **Event catalog types**: `shared/workflow/types/eventCatalog.ts`

## Commands / Runbooks

- (2026-01-04) Create migration: `npm run migration:create -- --name add_response_state_to_tickets`
- (2026-01-04) Run migrations: `npm run migrate`

## Implementation Order

1. Database migration (F001-F003)
2. Interface/type updates (F004)
3. Backend logic for automatic updates (F005-F008)
4. Event system integration (F031-F036, F039)
5. Ticket detail view (F022-F025)
6. Ticket list badges (F013-F016)
7. Ticket list filter (F017-F021)
8. Manual override UI (F009-F010, F023-F024)
9. Close behavior (F011-F012)
10. Client portal (F026-F030)
11. Workflow/Automation Hub integration (F037-F038)
12. Tenant isolation verification (F040)

## Links / References

- User request: "Can comments, or actions?, on tickets trigger status updates? ... when we reply to the client, we could have the option to change the status to 'Awaiting Response from Client'"
- Related: Automation Hub workflow system (`docs/workflow/automation-hub-workflow-guide.md`)
- PRD: `docs/plans/2026-01-04-ticket-response-state-tracking/PRD.md`

## Open Questions

1. ~~Should response state be a separate field or status metadata?~~ **Resolved: Separate field**
2. ~~Automatic vs opt-in behavior?~~ **Resolved: Automatic by default**
3. ~~Client portal visibility?~~ **Resolved: Visible to clients**
4. ~~UI display approach?~~ **Resolved: Badge on status + filter**
5. ~~Manual override capability?~~ **Resolved: Yes, via dropdown**
6. ~~On close behavior?~~ **Resolved: Clear to null**
7. ~~Workflow integration?~~ **Resolved: New event type**
8. Should the filter include time-based options (e.g., "Awaiting Client > 3 days")? → Deferred to future enhancement
