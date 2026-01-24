import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, EventPayloadSchemas, EventTypeEnum } from '../eventBusSchema';

describe('eventBusSchema (expanded domain events)', () => {
  it('keeps EventTypeEnum aligned with EVENT_TYPES', () => {
    expect(EventTypeEnum.options).toEqual([...EVENT_TYPES]);
  });

  it('provides a payload schema for every EventType', () => {
    for (const eventType of EVENT_TYPES) {
      expect(eventType in EventPayloadSchemas).toBe(true);
    }
  });

  it('encodes overlap decisions explicitly (comment/message + appointment/schedule-entry)', () => {
    expect(EventTypeEnum.options).toContain('TICKET_COMMENT_ADDED');
    expect(EventTypeEnum.options).toContain('TICKET_MESSAGE_ADDED');
    expect(EventTypeEnum.options).toContain('SCHEDULE_ENTRY_CREATED');
    expect(EventTypeEnum.options).toContain('APPOINTMENT_CREATED');
  });

  it('validates new domain event payloads (tenantId + occurredAt required)', () => {
    const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
    const occurredAt = new Date().toISOString();
    const ticketId = '4f6d2d0b-2500-4a0d-8c27-51a3b18c6a72';

    expect(
      EventPayloadSchemas.TICKET_STATUS_CHANGED.safeParse({
        tenantId,
        occurredAt,
        ticketId,
        previousStatusId: 'open',
        newStatusId: 'resolved',
      }).success
    ).toBe(true);

    expect(
      EventPayloadSchemas.TICKET_STATUS_CHANGED.safeParse({
        tenantId,
        ticketId,
        previousStatusId: 'open',
        newStatusId: 'resolved',
      }).success
    ).toBe(false);
  });
});
