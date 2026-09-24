import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), insert: vi.fn() }));
vi.mock('../publishers', () => ({ publishWorkflowEvent: mocks.publish }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ insert: () => ({ onConflict: () => ({ ignore: () => ({ returning: mocks.insert }) }) }) }) }),
}));

beforeEach(() => vi.clearAllMocks());

import { buildDateDomainEventDedupeKey, emitDateDomainEventOnce, toTenantLocalDate } from './dateDomainEvents';

describe('date domain event helpers', () => {
  it('projects warranty instants into the tenant local calendar date', () => {
    const date = toTenantLocalDate('2026-09-23T03:00:00.000Z', 'America/Los_Angeles');
    expect(date).toBe('2026-09-22');
    expect(buildDateDomainEventDedupeKey('ASSET_WARRANTY_EXPIRING', 'asset-1', date))
      .toBe('event:ASSET_WARRANTY_EXPIRING:asset-1:2026-09-22');
  });

  it('publishes only when it inserts the dedupe key', async () => {
    mocks.insert.mockResolvedValueOnce([{ dedupe_key: 'inserted' }]).mockResolvedValueOnce([]);
    mocks.publish.mockResolvedValue(undefined);
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-22', occursOn: '2026-09-22', payload: {} };
    await expect(emitDateDomainEventOnce({} as never, 'tenant-1', params)).resolves.toBe(true);
    await expect(emitDateDomainEventOnce({} as never, 'tenant-1', params)).resolves.toBe(false);
    expect(mocks.publish).toHaveBeenCalledOnce();
  });

  it('uses a stable event id for the same event key', async () => {
    mocks.insert.mockResolvedValue([{ dedupe_key: 'inserted' }]);
    mocks.publish.mockResolvedValue(undefined);
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-22', occursOn: '2026-09-22', payload: {} };
    await emitDateDomainEventOnce({} as never, 'tenant-1', params);
    await emitDateDomainEventOnce({} as never, 'tenant-1', params);
    expect(mocks.publish.mock.calls[0][1]).toEqual(mocks.publish.mock.calls[1][1]);
  });
});
