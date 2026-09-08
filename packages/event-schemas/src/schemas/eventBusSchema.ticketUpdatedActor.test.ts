import { describe, expect, it } from 'vitest';

import { EventSchemas } from './eventBusSchema';

// TICKET_UPDATED payloads are validated by a union of two shapes:
//   - the legacy shape (TicketEventPayloadSchema), which *requires* `userId`
//   - the canonical domain shape, which names the actor `updatedByUserId`
// Server-action publishers emit both fields, so they match the legacy branch and
// keep `userId`. The REST API emits only `updatedByUserId`, so it falls through to
// the canonical branch — and Zod strips the unmatched `userId`. Consumers must
// therefore read `updatedByUserId` first and treat `userId` as legacy-only.

const baseEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  timestamp: '2026-08-06T12:00:00.000Z',
  eventType: 'TICKET_UPDATED' as const,
};

const tenantId = '00000000-0000-4000-8000-000000000003';
const ticketId = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000004';

describe('TICKET_UPDATED actor field contract', () => {
  it('preserves userId for legacy payloads that send both actor fields', () => {
    const result: any = EventSchemas.TICKET_UPDATED.parse({
      ...baseEvent,
      payload: { tenantId, ticketId, userId: actorId, updatedByUserId: actorId },
    });

    expect(result.payload.userId).toBe(actorId);
  });

  it('drops userId for canonical REST API payloads, exposing the actor only as updatedByUserId', () => {
    const result: any = EventSchemas.TICKET_UPDATED.parse({
      ...baseEvent,
      payload: {
        tenantId,
        occurredAt: '2026-08-06T12:00:00.000Z',
        ticketId,
        updatedByUserId: actorId,
        changes: { status_id: { previous: 'open', new: 'closed' } },
      },
    });

    // The regression that broke production internal notifications: a consumer
    // reading `payload.userId` alone gets undefined for every API-driven update.
    expect(result.payload.userId).toBeUndefined();
    expect(result.payload.updatedByUserId).toBe(actorId);
  });

  it('resolves a non-null actor from either shape via updatedByUserId ?? userId', () => {
    const payloads = [
      { tenantId, ticketId, userId: actorId },
      {
        tenantId,
        occurredAt: '2026-08-06T12:00:00.000Z',
        ticketId,
        updatedByUserId: actorId,
      },
    ];

    for (const payload of payloads) {
      const parsed: any = EventSchemas.TICKET_UPDATED.parse({ ...baseEvent, payload });
      expect(parsed.payload.updatedByUserId ?? parsed.payload.userId).toBe(actorId);
    }
  });
});
