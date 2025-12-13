# Event System Architecture

The event system provides a Redis-based streaming mechanism for handling asynchronous events across the application. It supports multi-tenant isolation while maintaining a simple and efficient subscription model.

## Event Structure

Events consist of three main components:

1. **Core Event Properties**
   - `id`: UUID for event identification
   - `eventType`: Type of event (e.g., 'TICKET_CREATED')
   - `timestamp`: ISO datetime of event creation
   - `payload`: Event-specific data including tenant information

2. **Event Payload**
   All event payloads extend a base schema that includes tenant information (defined in [events.ts](../server/src/lib/eventBus/events.ts)):
   ```typescript
   const BasePayloadSchema = z.object({
     tenantId: z.string().uuid(),
   });
   ```

3. **Event Types**
   The system supports various event types (defined in [events.ts](../server/src/lib/eventBus/events.ts)):
   ```typescript
   export const EventTypeEnum = z.enum([
     'TICKET_CREATED',
     'TICKET_UPDATED',
     'TICKET_CLOSED',
     'PROJECT_CREATED',
     'PROJECT_UPDATED',
     'PROJECT_CLOSED',
     'TIME_ENTRY_SUBMITTED',
     'TIME_ENTRY_APPROVED',
     'INVOICE_GENERATED',
     'INVOICE_FINALIZED',
   ]);
   ```

## Channel Management

Events are published to Redis channels based solely on event type:

```typescript
// Channel naming pattern
`${prefix}:${eventType}`  // e.g., "event::TICKET_UPDATED"
```

This simplified channel structure allows for:
- Easy subscription to all events of a specific type
- Reduced Redis channel complexity
- Simpler subscription management

## Multi-tenant Handling

Tenant isolation is maintained through the event payload rather than channel segregation:

1. **Event Publishing**
   Example from [ticketActions.ts](../server/src/lib/actions/ticket-actions/ticketActions.ts):
   ```typescript
   await eventBus.publish({
     eventType: 'TICKET_UPDATED',
     payload: {
       tenantId: tenant,
       ticketId: id,
       userId: user.user_id,
       changes: updateData
     }
   });
   ```

2. **Event Handling**
   Notification recipients are determined through:
   - The company email (from tickets.company_id foreign key relationship)
   - The assigned user's email (from tickets.assigned_to)
   - Additional resources (from ticket_resources table)

   Example from [ticketEmailSubscriber.ts](../server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts):
   ```typescript
   async function handleTicketUpdated(event: TicketUpdatedEvent): Promise<void> {
     const { payload } = event;
     const { tenantId } = payload;
     
     const { knex: db } = await createTenantKnex();
     
     // Get ticket details with company email
     const ticket = await db('tickets as t')
       .select(
         't.*',
         'c.email as company_email',
         'u.email as assigned_to_email'
       )
       .leftJoin('companies as c', function() {
         this.on('t.company_id', 'c.company_id')
             .andOn('t.tenant', 'c.tenant');
       })
       .leftJoin('users as u', function() {
         this.on('t.assigned_to', 'u.user_id')
             .andOn('t.tenant', 'u.tenant');
       })
       .where('t.ticket_id', payload.ticketId)
       .first();

     // Get additional resources
     const additionalResources = await db('ticket_resources as tr')
       .select('u.email as email')
       .leftJoin('users as u', function() {
         this.on('tr.additional_user_id', 'u.user_id')
             .andOn('tr.tenant', 'u.tenant');
       })
       .where({
         'tr.ticket_id': payload.ticketId,
         'tr.tenant': tenantId
       });

     // Send notifications to:
     // 1. Company email
     // 2. Assigned user
     // 3. Additional resources
     // ... handle event
   }
   ```

## Subscription Management

Subscribers register for specific event types:

```typescript
// Subscribe to an event type
await eventBus.subscribe(
  'TICKET_UPDATED',
  async (event) => {
    const { tenantId } = event.payload;
    // ... handle event
  }
);
```

## Type Safety

The event system uses Zod schemas to ensure type safety:

1. **Event Schema Definition**
   From [events.ts](../server/src/lib/eventBus/events.ts):
   ```typescript
   export const TicketEventPayloadSchema = BasePayloadSchema.extend({
     ticketId: z.string().uuid(),
     userId: z.string().uuid(),
     changes: z.record(z.unknown()).optional(),
   });
   ```

2. **Event Type Generation**
   From [events.ts](../server/src/lib/eventBus/events.ts):
   ```typescript
   export const EventSchemas = Object.entries(EventPayloadSchemas).reduce(
     (schemas, [eventType, payloadSchema]) => ({
       ...schemas,
       [eventType]: BaseEventSchema.extend({
         eventType: z.literal(eventType as EventType),
         payload: payloadSchema,
       }),
     }),
     {} as Record<EventType, z.ZodType>
   );

   export type TicketUpdatedEvent = z.infer<typeof EventSchemas.TICKET_UPDATED>;
   ```

## Example Usage

### Publishing Events

From [ticketActions.ts](../server/src/lib/actions/ticket-actions/ticketActions.ts):
```typescript
// In updateTicket function
if (newStatus?.is_closed && !oldStatus?.is_closed) {
  await eventBus.publish({
    eventType: 'TICKET_CLOSED',
    payload: {
      tenantId: tenant,
      ticketId: id,
      userId: user.user_id,
      changes: updateData
    }
  });
} else {
  await eventBus.publish({
    eventType: 'TICKET_UPDATED',
    payload: {
      tenantId: tenant,
      ticketId: id,
      userId: user.user_id,
      changes: updateData
    }
  });
}
```

### Subscribing to Events

From [ticketEmailSubscriber.ts](../server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts):
```typescript
export async function registerTicketEmailSubscriber(): Promise<void> {
  const wrappedHandleTicketUpdated = async (event: Event) => {
    const typedEvent = event as TicketUpdatedEvent;
    return handleTicketUpdated(typedEvent);
  };
  
  await eventBus.subscribe(
    'TICKET_UPDATED',
    wrappedHandleTicketUpdated
  );
}
```

## Error Handling

The event system includes comprehensive error handling:

1. **Event Validation**
   - Schema validation for all events and payloads
   - Type checking for event handlers
   - Tenant validation

2. **Redis Connection**
   - Automatic reconnection handling
   - Connection error logging
   - Failed event handling

3. **Event Processing**
   - Individual handler error isolation
   - Error logging with context
   - Failed event tracking

## Best Practices

1. **Event Publishing**
   - Always include tenant in payload
   - Use typed event interfaces
   - Include relevant context in payload

2. **Event Handling**
   - Extract tenant from payload
   - Use tenant-aware database connections
   - Handle errors gracefully

3. **Subscription Management**
   - Subscribe to specific event types
   - Use typed event handlers
   - Clean up subscriptions when done

## Implementation Details

The event system is implemented using:
- Redis for event streaming
- Zod for schema validation
- TypeScript for type safety
- Knex.js for database operations

Key files:
- `eventBus/events.ts`: Event type definitions
- `eventBus/index.ts`: Core event bus implementation
- `eventBus/initialize.ts`: System initialization
- `eventBus/subscribers/`: Event handlers
