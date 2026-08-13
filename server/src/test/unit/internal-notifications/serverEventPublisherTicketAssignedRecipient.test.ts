import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

describe('regression: v2 TICKET_ASSIGNED publisher must carry the assignee as userId', () => {
  it('ServerEventPublisher.publishTicketAssigned emits userId so the assignee survives schema validation', async () => {
    const { ServerEventPublisher } = await import('@alga-psa/event-bus/adapters/serverEventPublisher');
    const { EventSchemas } = await import('@alga-psa/event-schemas');

    const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
    const ASSIGNEE = '6684ee32-8f0a-46fb-b84c-4563337b2766';
    const ASSIGNER = '00000000-0000-4000-8000-000000000001';

    // Capture the payload the publisher emits before it hits the bus.
    let captured: Record<string, any> = {};
    const publisher = new ServerEventPublisher() as any;
    const orig = publisher.safePublishWorkflowEvent;
    publisher.safePublishWorkflowEvent = async (_t: string, _te: string, _a: string | undefined, payload: Record<string, any>) => {
      captured = payload;
    };
    await publisher.publishTicketAssigned({
      tenantId: TENANT,
      ticketId: randomUUID(),
      userId: ASSIGNEE,
      assignedByUserId: ASSIGNER,
    });
    publisher.safePublishWorkflowEvent = orig;

    expect(captured.userId).toBe(ASSIGNEE);

    // The subscriber validates with EventSchemas.TICKET_ASSIGNED (union). Confirm
    // the emitted payload retains payload.userId = the assignee after validation.
    const event = {
      id: randomUUID(),
      eventType: 'TICKET_ASSIGNED',
      timestamp: new Date().toISOString(),
      payload: {
        ...captured,
        tenantId: TENANT,
        occurredAt: new Date().toISOString(),
        actorType: 'USER',
        actorUserId: ASSIGNER,
      },
    } as any;

    const validated: any = EventSchemas.TICKET_ASSIGNED.parse(event);
    expect(validated.payload.userId).toBe(ASSIGNEE);
  });
});
