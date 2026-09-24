import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), insert: vi.fn(), delete: vi.fn(), insertRow: undefined as Record<string, unknown> | undefined }));
vi.mock('../publishers', () => ({ publishWorkflowEvent: mocks.publish }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({
    insert: (row: Record<string, unknown>) => {
      mocks.insertRow = row;
      return { onConflict: () => ({ ignore: () => ({ returning: mocks.insert }) }) };
    },
    where: () => ({ delete: mocks.delete }),
  }) }),
}));

beforeEach(() => vi.clearAllMocks());

import { buildDateDomainEventDedupeKey, emitDateDomainEventOnce, normalizeDateDomainKeyDate, toTenantLocalDate } from './dateDomainEvents';

describe('date domain event helpers', () => {
  it('normalizes Postgres dates from local calendar fields and datetime strings from their date part', () => {
    expect(normalizeDateDomainKeyDate(new Date(2021, 9, 24))).toBe('2021-10-24');
    expect(normalizeDateDomainKeyDate('2021-10-24T00:00:00.000Z')).toBe('2021-10-24');
  });

  it('projects warranty instants into the tenant local calendar date', () => {
    const date = toTenantLocalDate('2026-09-23T03:00:00.000Z', 'America/Los_Angeles');
    expect(date).toBe('2026-09-22');
    expect(buildDateDomainEventDedupeKey('ASSET_WARRANTY_EXPIRING', 'asset-1', date))
      .toBe('event:ASSET_WARRANTY_EXPIRING:asset-1:2026-09-22');
  });

  it('projects dates across a DST boundary and the UTC-12 / UTC+12 extremes', () => {
    expect(toTenantLocalDate('2026-03-08T04:59:00.000Z', 'America/New_York')).toBe('2026-03-07');
    expect(toTenantLocalDate('2026-03-08T05:00:00.000Z', 'America/New_York')).toBe('2026-03-08');
    expect(toTenantLocalDate('2026-09-23T00:30:00.000Z', 'Etc/GMT+12')).toBe('2026-09-22');
    expect(toTenantLocalDate('2026-09-22T12:30:00.000Z', 'Pacific/Kiritimati')).toBe('2026-09-23');
  });

  it('publishes only when it inserts the dedupe key', async () => {
    mocks.insert.mockResolvedValueOnce([{ dedupe_key: 'inserted' }]).mockResolvedValueOnce([]);
    mocks.publish.mockResolvedValue(undefined);
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-22', occursOn: '2026-09-22', payload: {} };
    await expect(emitDateDomainEventOnce({} as never, 'tenant-1', params)).resolves.toBe(true);
    await expect(emitDateDomainEventOnce({} as never, 'tenant-1', params)).resolves.toBe(false);
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.insertRow?.emitted_at).toBeInstanceOf(Date);
  });

  it('uses a stable event id for the same event key', async () => {
    mocks.insert.mockResolvedValue([{ dedupe_key: 'inserted' }]);
    mocks.publish.mockResolvedValue(undefined);
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-22', occursOn: '2026-09-22', payload: {} };
    await emitDateDomainEventOnce({} as never, 'tenant-1', params);
    await emitDateDomainEventOnce({} as never, 'tenant-1', params);
    expect(mocks.publish.mock.calls[0][1]).toEqual(mocks.publish.mock.calls[1][1]);
  });

  it('removes its ledger row when publishing fails so a later scan can retry', async () => {
    mocks.insert.mockResolvedValue([{ dedupe_key: 'inserted' }]);
    mocks.delete.mockResolvedValue(1);
    mocks.publish.mockRejectedValueOnce(new Error('publish unavailable'));
    const params = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-22', occursOn: '2026-09-22', payload: {} };
    await expect(emitDateDomainEventOnce({} as never, 'tenant-1', params)).rejects.toThrow('publish unavailable');
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
});
