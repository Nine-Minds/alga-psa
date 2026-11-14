import { beforeEach, describe, expect, it, vi } from 'vitest';

const runFull = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn(async () => ({ fake: true })));
const settingsRow = vi.hoisted(() => ({ current: { settings: { connectionMode: 'local' } } as any }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => settingsRow.current }) }) }),
}));
vi.mock('../../../lib/integrations/unifi/unifiApiClient', () => ({ createUniFiClient: createClient }));
vi.mock('../../../lib/integrations/unifi/sync/syncEngine', () => ({ runUniFiFullSync: runFull }));

const { uniFiDeviceSyncStrategy } = await import('../../../lib/integrations/unifi/sync/deviceSyncStrategy');

describe('uniFiDeviceSyncStrategy', () => {
  beforeEach(() => {
    runFull.mockReset();
    createClient.mockClear();
  });

  it('runs a full sync in the configured mode, ignoring `since`, and reports items processed', async () => {
    runFull.mockResolvedValue({ success: true, items_processed: 7, items_failed: 0 });
    const out = await uniFiDeviceSyncStrategy.syncDevicesIncremental({
      tenantId: 't1',
      integrationId: 'i1',
      since: new Date('2020-01-01'),
    });
    expect(out).toEqual({ devicesProcessed: 7 });
    expect(createClient).toHaveBeenCalledWith('t1', 'local');
    expect(runFull).toHaveBeenCalledWith({ tenant: 't1', integrationId: 'i1' }, expect.anything());
  });

  it('throws when the sync reports failure so the job does not advance its cursor', async () => {
    runFull.mockResolvedValue({ success: false, items_processed: 2, items_failed: 1, errors: ['Site HQ: device listing failed'] });
    await expect(
      uniFiDeviceSyncStrategy.syncDevicesIncremental({ tenantId: 't1', integrationId: 'i1', since: new Date() })
    ).rejects.toThrow(/Site HQ/);
  });
});
