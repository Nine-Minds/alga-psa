import { beforeEach, describe, expect, it, vi } from 'vitest';

let siteSyncResult: any;
const siteSync = vi.fn(async (_args: any) => siteSyncResult);
const provision = vi.fn(async (_args: any): Promise<any> => null);
const deviceSync = vi.fn(async (..._args: any[]) => ({
  success: true,
  items_processed: 5,
  items_created: 0,
  items_updated: 0,
  items_failed: 0,
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@ee/lib/integrations/datto/siteSync', () => ({
  runDattoRmmSiteSync: (args: any) => siteSync(args),
}));
vi.mock('@ee/lib/integrations/datto/siteClientProvisioning', () => ({
  provisionClientsForNewDattoSitesIfEnabled: (args: any) => provision(args),
}));
vi.mock('@ee/lib/integrations/datto/deviceSync', () => ({
  runDattoRmmDeviceSync: (...args: any[]) => deviceSync(...args),
}));

import { dattoRmmDeviceSyncStrategy } from '@ee/lib/integrations/datto/deviceSyncStrategy';

const input = { tenantId: 'tenant_1', integrationId: 'integration_1', since: new Date('2026-10-19T10:00:00.000Z') };

describe('dattoRmmDeviceSyncStrategy site refresh', () => {
  beforeEach(() => {
    siteSyncResult = { success: true, items_processed: 2, created_site_uids: ['site-new'] };
    for (const fn of [siteSync, provision, deviceSync]) fn.mockClear();
  });

  it('refreshes sites before the device sync', async () => {
    const order: string[] = [];
    siteSync.mockImplementationOnce(async () => {
      order.push('sites');
      return siteSyncResult;
    });
    deviceSync.mockImplementationOnce(async () => {
      order.push('devices');
      return { success: true, items_processed: 1, items_created: 0, items_updated: 0, items_failed: 0 };
    });

    await dattoRmmDeviceSyncStrategy.syncDevicesIncremental(input);

    expect(order).toEqual(['sites', 'devices']);
  });

  it('hands the newly found sites to the opt-in client hook', async () => {
    await dattoRmmDeviceSyncStrategy.syncDevicesIncremental(input);
    expect(provision).toHaveBeenCalledWith({ tenant: 'tenant_1', newSiteUids: ['site-new'] });
  });

  it('does not call the hook when the site refresh failed', async () => {
    siteSyncResult = { success: false, error: 'boom' };
    await dattoRmmDeviceSyncStrategy.syncDevicesIncremental(input);
    expect(provision).not.toHaveBeenCalled();
  });

  it('still syncs devices when the site refresh fails', async () => {
    siteSync.mockImplementationOnce(async () => {
      throw new Error('Datto down');
    });
    await expect(dattoRmmDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({ devicesProcessed: 5 });
    expect(deviceSync).toHaveBeenCalledTimes(1);
  });
});
