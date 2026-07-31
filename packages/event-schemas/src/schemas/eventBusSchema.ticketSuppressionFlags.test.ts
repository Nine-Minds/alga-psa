import { describe, expect, it } from 'vitest';

import { EventSchemas } from './eventBusSchema';

const baseEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  timestamp: '2026-07-09T12:00:00.000Z',
};

const baseDomainPayload = {
  tenantId: 'tenant-1',
  occurredAt: '2026-07-09T12:00:00.000Z',
  ticketId: '00000000-0000-4000-8000-000000000002',
  changes: {
    status_id: {
      previous: 'open',
      new: 'closed',
    },
  },
};

describe('ticket lifecycle notification suppression event schemas', () => {
  it.each([
    'TICKET_UPDATED',
    'TICKET_CLOSED',
    'TICKET_ASSIGNED',
  ] as const)('defaults suppression flags to false for legacy %s payloads', (eventType) => {
    const result = EventSchemas[eventType].parse({
      ...baseEvent,
      eventType,
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000003',
        ticketId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000004',
      },
    });

    expect(result.payload).toEqual(
      expect.objectContaining({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      })
    );
  });

  it.each([
    'TICKET_UPDATED',
    'TICKET_CLOSED',
    'TICKET_ASSIGNED',
  ] as const)('accepts boolean suppression flags for domain %s payloads', (eventType) => {
    const result = EventSchemas[eventType].parse({
      ...baseEvent,
      eventType,
      payload: {
        ...baseDomainPayload,
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    });

    expect(result.payload).toEqual(
      expect.objectContaining({
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      })
    );
  });

  it.each([
    'TICKET_UPDATED',
    'TICKET_CLOSED',
    'TICKET_ASSIGNED',
  ] as const)('rejects non-boolean suppression flags for %s', (eventType) => {
    const result = EventSchemas[eventType].safeParse({
      ...baseEvent,
      eventType,
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000003',
        ticketId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000004',
        suppressContactNotifications: 'yes',
        suppressInternalNotifications: false,
      },
    });

    expect(result.success).toBe(false);
  });
});
