import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publishWorkflowEvent, returning, insert } = vi.hoisted(() => {
  const returning = vi.fn();
  const publishWorkflowEvent = vi.fn();
  const insert = vi.fn(() => ({ onConflict: vi.fn(() => ({ ignore: vi.fn(() => ({ returning })) })) }));
  return { publishWorkflowEvent, returning, insert };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => ({ insert }) }) }));

import { emitDateDomainEventOnce } from './emitOnce';

describe('emitDateDomainEventOnce', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not publish on a duplicate and uses a stable event id', async () => {
    returning.mockResolvedValueOnce([]).mockResolvedValueOnce([{ dedupe_key: 'inserted' }]);
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-10-01', occursOn: '2026-10-01', payload: { clientId: 'client-1' } };
    expect(await emitDateDomainEventOnce({} as any, 'tenant-1', params)).toBe(false);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    expect(await emitDateDomainEventOnce({} as any, 'tenant-1', params)).toBe(true);
    const eventId = publishWorkflowEvent.mock.calls[0][1].eventId;
    returning.mockResolvedValueOnce([{ dedupe_key: 'inserted' }]);
    await emitDateDomainEventOnce({} as any, 'tenant-1', params);
    expect(publishWorkflowEvent.mock.calls[1][1].eventId).toBe(eventId);
  });
});
