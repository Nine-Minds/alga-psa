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

  it('accepts and defaults suppression flags for additional-agent assignment events', () => {
    const legacy = EventSchemas.TICKET_ADDITIONAL_AGENT_ASSIGNED.parse({
      ...baseEvent,
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000003',
        ticketId: '00000000-0000-4000-8000-000000000002',
        primaryAgentId: '00000000-0000-4000-8000-000000000004',
        additionalAgentId: '00000000-0000-4000-8000-000000000005',
        assignedByUserId: '00000000-0000-4000-8000-000000000006',
      },
    });
    const silent = EventSchemas.TICKET_ADDITIONAL_AGENT_ASSIGNED.parse({
      ...baseEvent,
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      payload: {
        ...legacy.payload,
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    });

    expect(legacy.payload).toEqual(expect.objectContaining({
      suppressContactNotifications: false,
      suppressInternalNotifications: false,
    }));
    expect(silent.payload).toEqual(expect.objectContaining({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    }));
  });

  describe('TICKET_CREATED', () => {
    const systemCreatedPayload = {
      tenantId: '00000000-0000-4000-8000-000000000003',
      ticketId: '00000000-0000-4000-8000-000000000002',
      occurredAt: '2026-07-09T12:00:00.000Z',
      actorType: 'SYSTEM',
      source: 'recurring_ticket',
    };

    it('keeps contact suppression on a system-created payload (no userId) instead of stripping it', () => {
      const result = EventSchemas.TICKET_CREATED.parse({
        ...baseEvent,
        eventType: 'TICKET_CREATED',
        payload: { ...systemCreatedPayload, suppressContactNotifications: true },
      });

      expect(result.payload).toEqual(expect.objectContaining({ suppressContactNotifications: true }));
    });

    it('defaults suppression flags to false so creators that never set them are unchanged', () => {
      const result = EventSchemas.TICKET_CREATED.parse({
        ...baseEvent,
        eventType: 'TICKET_CREATED',
        payload: systemCreatedPayload,
      });

      expect(result.payload).toEqual(expect.objectContaining({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      }));
    });
  });
});

describe('TICKET_CREATED requester identity', () => {
  it('keeps clientName/contactName/senderEmail/requesterName through both union branches', () => {
    const requester = { senderEmail: 'who@example.test', requesterName: 'who@example.test' };
    const legacy = EventSchemas.TICKET_CREATED.parse({
      id: '11111111-1111-4111-8111-111111111111',
      eventType: 'TICKET_CREATED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: '22222222-2222-4222-8222-222222222222',
        ticketId: '33333333-3333-4333-8333-333333333333',
        userId: '33333333-3333-4333-8333-333333333333',
        ...requester,
      },
    });
    expect(legacy.payload).toMatchObject(requester);
  });
});
