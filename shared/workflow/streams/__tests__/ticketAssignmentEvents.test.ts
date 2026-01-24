import { describe, expect, it } from 'vitest';
import { EventPayloadSchemas } from '../eventBusSchema';

describe('ticket assignment event payloads', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const occurredAt = '2026-01-24T12:00:00.000Z';
  const ticketId = '4f6d2d0b-2500-4a0d-8c27-51a3b18c6a72';
  const userA = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const userB = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';

  it('accepts domain-shaped TICKET_ASSIGNED payloads with previous/new assignee context', () => {
    const parsed = EventPayloadSchemas.TICKET_ASSIGNED.safeParse({
      tenantId,
      occurredAt,
      ticketId,
      userId: userB, // legacy assigned user
      assignedByUserId: userA,
      previousAssigneeId: userA,
      previousAssigneeType: 'user',
      newAssigneeId: userB,
      newAssigneeType: 'user',
      assignedAt: occurredAt,
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts TICKET_UNASSIGNED payloads with previous assignee context', () => {
    const parsed = EventPayloadSchemas.TICKET_UNASSIGNED.safeParse({
      tenantId,
      occurredAt,
      ticketId,
      previousAssigneeId: userA,
      previousAssigneeType: 'user',
      unassignedAt: occurredAt,
    });

    expect(parsed.success).toBe(true);
  });
});

