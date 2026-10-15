import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, EventPayloadSchemas } from '../eventBusSchema';

describe('CLIENT_ANNIVERSARY_UPCOMING schema registration', () => {
  it('registers and validates the planned payload shape', () => {
    expect(EVENT_TYPES).toContain('CLIENT_ANNIVERSARY_UPCOMING');
    expect(EventPayloadSchemas.CLIENT_ANNIVERSARY_UPCOMING.parse({
      tenantId: '00000000-0000-4000-8000-000000000001', occurredAt: '2026-09-23T12:00:00.000Z',
      clientId: '00000000-0000-4000-8000-000000000002', clientName: 'Acme', anniversaryDate: '2026-10-01', yearsAsClient: 2, daysUntilAnniversary: 8,
    })).toMatchObject({ clientName: 'Acme', daysUntilAnniversary: 8 });
    expect(EventPayloadSchemas.CLIENT_ANNIVERSARY_UPCOMING.safeParse({
      tenantId: '00000000-0000-4000-8000-000000000001', occurredAt: '2026-09-23T12:00:00.000Z',
      clientId: '00000000-0000-4000-8000-000000000002', clientName: 'Acme', anniversaryDate: '2026-10-01', yearsAsClient: 2, daysUntil: 8,
    }).success).toBe(false);
  });
});
