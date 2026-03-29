# PRD — Ticket Response State Tracking

- Slug: `ticket-response-state-tracking`
- Date: `2026-01-04`
- Status: Draft

## Summary

Add a `response_state` field to tickets that automatically tracks who needs to respond next (client or internal support). When internal staff posts a client-visible comment, the ticket indicates "awaiting client response". When a client responds, it indicates "awaiting internal response". This helps MSPs see at a glance what's holding up each ticket from the overview screen.

## Problem

MSPs currently have no visibility into whether a ticket is blocked waiting for a client response or needs internal action. The existing status field represents workflow stage (New, In Progress, On Hold, etc.) but doesn't capture the orthogonal dimension of "whose turn is it to respond."

This leads to:
- Tickets sitting idle because staff doesn't realize the client already responded
- Clients waiting for responses without visibility into the ticket's state
- Difficulty prioritizing work queue—tickets awaiting client response shouldn't be at the top of an agent's list
- No easy way to filter the ticket list by response state

## Goals

- Add a `response_state` field to tickets that tracks who needs to respond next
- Automatically update response state when comments are posted (based on author type)
- Display response state as a badge on the status pill in ticket lists
- Add a filter to toggle/filter by response state
- Allow manual override of response state for edge cases
- Make response state visible to clients in the client portal
- Emit events for workflow automation integration

## Non-goals

- Changing or replacing the existing status system
- Adding SLA timers or escalation rules (can be built on top via workflows)
- Building notification templates for response state changes (can use workflow events)
- Adding response state to projects or other entity types (tickets only for now)

## Users and Primary Flows

### Persona: MSP Support Agent

1. Agent opens ticket list and sees response state badges on each ticket's status
2. Agent filters list to show only "Awaiting Internal Response" tickets to prioritize their queue
3. Agent responds to client with a comment; response state automatically changes to "Awaiting Client"
4. Agent can manually set response state if needed (e.g., waiting for internal approval)

### Persona: MSP Manager

1. Manager views ticket list and can quickly identify stuck tickets
2. Manager filters by "Awaiting Client Response > 3 days" to follow up on stale tickets
3. Manager uses workflow automation to trigger notifications when response state changes

### Persona: Client (via Client Portal)

1. Client views their ticket and sees it's marked "Awaiting Your Response"
2. Client responds with a comment; state changes to "Awaiting Support Response"
3. Client has visibility into whether the MSP has seen their response

## UX / UI Notes

### Ticket List (MSP Portal)

- **Badge on status**: Small badge/icon overlay on the existing status pill
  - "Awaiting Client" → clock icon with outbound arrow (or similar)
  - "Awaiting Internal" → clock icon with inbound arrow
  - No state (null) → no badge
- **Filter dropdown**: Add "Response State" filter with options:
  - All
  - Awaiting Client Response
  - Awaiting Internal Response
  - No Response State

### Ticket Detail View

- Display current response state near the status dropdown
- Add dropdown/button for manual override: "Set Response State" → [Awaiting Client | Awaiting Internal | Clear]
- Response state should update visually immediately when a comment is posted

### Client Portal

- Show response state as a label on ticket (human-friendly text):
  - "Awaiting Your Response" (when awaiting_client)
  - "Awaiting Support Response" (when awaiting_internal)
- Badge styling consistent with MSP portal but possibly different wording

### Comment Creation

- No checkbox needed—response state updates automatically based on:
  - Internal staff posts client-visible comment → `awaiting_client`
  - Client posts comment → `awaiting_internal`
  - Internal note (is_internal=true) → no change

## Requirements

### Functional Requirements

**FR1: Response State Field**
- Add `response_state` enum field to tickets table
- Values: `'awaiting_client'`, `'awaiting_internal'`, `null`
- Field is nullable—null means no response state tracking needed (e.g., new tickets, informational tickets)
- Field is tenant-scoped (follows existing ticket multi-tenancy)

**FR2: Automatic State Updates on Comments**
- When a comment is created:
  - If `author_type='internal'` AND `is_internal=false` → set `response_state='awaiting_client'`
  - If `author_type='client'` → set `response_state='awaiting_internal'`
  - If `is_internal=true` (internal note) → no change to response state
- Updates should happen atomically with comment creation

**FR3: Manual Override**
- Staff can manually set response state via UI control
- Available options: "Awaiting Client", "Awaiting Internal", "Clear"
- Manual changes should be auditable (logged in ticket history if available)

**FR4: Clear on Close**
- When a ticket is closed (`is_closed=true`), set `response_state=null`
- Preserve existing behavior of status changes on close

**FR5: Ticket List Badge**
- Display response state as a badge overlay on the status pill
- Badge should be visually distinct but not overwhelming
- Badge should have tooltip with full text on hover

**FR6: Ticket List Filter**
- Add "Response State" filter to ticket list
- Support multi-select or single-select filtering
- Filter should work in combination with existing filters (status, assignee, etc.)

**FR7: Client Portal Visibility**
- Display response state on ticket list and detail view in client portal
- Use client-friendly wording ("Awaiting Your Response" vs "Awaiting Client")

**FR8: Workflow Event**
- Emit `TICKET_RESPONSE_STATE_CHANGED` event when response state changes
- Event payload includes: `tenantId`, `ticketId`, `userId`, `previousState`, `newState`, `trigger` (comment|manual|close)
- Event should be available for workflow triggers in Automation Hub

### Non-functional Requirements

- Response state updates should not add noticeable latency to comment creation
- Badge rendering should not impact ticket list performance
- Filter queries should be indexed for performance

## Data / API / Integrations

### Database Migration

```sql
-- Add response_state enum type
CREATE TYPE ticket_response_state AS ENUM ('awaiting_client', 'awaiting_internal');

-- Add column to tickets table
ALTER TABLE tickets ADD COLUMN response_state ticket_response_state;

-- Add index for filtering
CREATE INDEX idx_tickets_response_state ON tickets(tenant, response_state)
  WHERE response_state IS NOT NULL;
```

### Interface Updates

```typescript
// In ticket.interfaces.tsx
type TicketResponseState = 'awaiting_client' | 'awaiting_internal' | null;

interface ITicket {
  // ... existing fields
  response_state: TicketResponseState;
}
```

### Event Schema

```typescript
// In events.ts
const TicketResponseStateChangedEventSchema = z.object({
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  previousState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  newState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  trigger: z.enum(['comment', 'manual', 'close']),
});
```

### API Changes

- `updateTicket()` action accepts `response_state` field
- Comment creation actions automatically update response state
- New event type registered in event catalog

## Security / Permissions

- Response state follows existing ticket permissions—users who can view a ticket can see its response state
- Manual override requires ticket edit permissions
- Client portal users can see response state but cannot manually change it
- Events respect tenant isolation

## Observability

- Log response state changes with: ticket_id, previous_state, new_state, trigger, user_id
- Include response state in existing ticket audit trail if available

## Rollout / Migration

- **Migration**: Add column with NULL default; existing tickets start with no response state
- **Backfill**: Not needed—response state only relevant for ongoing conversations
- **Feature flag**: Not required; feature is additive and low-risk

## Open Questions

1. ~~Should response state be a separate field or status metadata?~~ **Decided: Separate field**
2. ~~Automatic vs opt-in behavior?~~ **Decided: Automatic by default**
3. ~~Client portal visibility?~~ **Decided: Visible to clients**
4. ~~UI display approach?~~ **Decided: Badge on status + filter**
5. Should the filter include time-based options (e.g., "Awaiting Client > 3 days")? → Defer to future enhancement

## Acceptance Criteria (Definition of Done)

- [ ] `response_state` field exists on tickets table with proper enum type
- [ ] Creating a client-visible comment as staff sets response_state to 'awaiting_client'
- [ ] Creating a comment as client sets response_state to 'awaiting_internal'
- [ ] Internal notes do not change response state
- [ ] Response state badge displays on ticket list status pills
- [ ] Response state filter works on ticket list
- [ ] Manual override UI allows staff to change response state
- [ ] Closing a ticket clears response state to null
- [ ] `TICKET_RESPONSE_STATE_CHANGED` event fires on state changes
- [ ] Response state visible in client portal with client-friendly wording
- [ ] Workflow triggers can be configured for response state change events
