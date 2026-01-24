import { describe, expect, it } from 'vitest';
import { EventPayloadSchemas } from '../eventBusSchema';

describe('ticket relationship events', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const occurredAt = '2026-01-24T12:00:00.000Z';
  const ticketA = '4f6d2d0b-2500-4a0d-8c27-51a3b18c6a72';
  const ticketB = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';

  it('accepts TICKET_MERGED payloads', () => {
    const parsed = EventPayloadSchemas.TICKET_MERGED.safeParse({
      tenantId,
      occurredAt,
      sourceTicketId: ticketA,
      targetTicketId: ticketB,
      mergedAt: occurredAt,
      reason: 'bundle_attach',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts TICKET_SPLIT payloads', () => {
    const parsed = EventPayloadSchemas.TICKET_SPLIT.safeParse({
      tenantId,
      occurredAt,
      originalTicketId: ticketA,
      newTicketIds: [ticketB],
      splitAt: occurredAt,
      reason: 'bundle_detach',
    });

    expect(parsed.success).toBe(true);
  });
});

