/**
 * Hudu tenant-wide sync actions — gating + delegation to runHuduTenantSync,
 * and the auto-sync toggle (persist settings.autoSync + converge schedule).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-tsa';
const internalUser = { user_id: 'clicker', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runHuduTenantSyncMock = vi.fn();
const mergeHuduSettingsMock = vi.fn();
const scheduleHuduAutoSyncJobMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('server/src/lib/feature-flags/featureFlags', () => ({ featureFlags: { isEnabled: isEnabledMock } }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: assertTierAccessMock }));
vi.mock('server/src/lib/db', () => ({ createTenantKnex: createTenantKnexMock }));
vi.mock('@ee/lib/integrations/hudu/tenantSync', () => ({ runHuduTenantSync: runHuduTenantSyncMock }));
vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  mergeHuduSettings: mergeHuduSettingsMock,
}));
vi.mock('server/src/lib/jobs/handlers/huduAutoSyncHandler', () => ({
  scheduleHuduAutoSyncJob: scheduleHuduAutoSyncJobMock,
}));

async function loadActions() {
  return import('@ee/lib/actions/integrations/huduTenantSyncActions');
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: TENANT });
  runHuduTenantSyncMock.mockResolvedValue({
    sync_type: 'import',
    clients: 1,
    items_created: 3,
    items_updated: 1,
    items_skipped: 0,
    items_failed: 0,
    errors: [],
  });
});

describe('importAllHuduClients', () => {
  it('runs the tenant sync with importNew + the clicking user and returns the summary', async () => {
    const { importAllHuduClients } = await loadActions();

    const result = await importAllHuduClients();

    expect(runHuduTenantSyncMock).toHaveBeenCalledWith(TENANT, { importNew: true, actorUserId: 'clicker' });
    expect(result).toMatchObject({ success: true, data: { items_created: 3 } });
  });

  it('requires asset:create', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { importAllHuduClients } = await loadActions();
    await expect(importAllHuduClients()).rejects.toThrow(/insufficient permissions/);
    expect(runHuduTenantSyncMock).not.toHaveBeenCalled();
  });
});

describe('syncAllHuduClients', () => {
  it('runs the tenant sync with importNew=false', async () => {
    const { syncAllHuduClients } = await loadActions();
    await syncAllHuduClients();
    expect(runHuduTenantSyncMock).toHaveBeenCalledWith(TENANT, { importNew: false, actorUserId: 'clicker' });
  });
});

describe('setHuduAutoSync', () => {
  it('persists the toggle and converges the schedule', async () => {
    const { setHuduAutoSync } = await loadActions();

    const result = await setHuduAutoSync({ enabled: true });

    expect(mergeHuduSettingsMock).toHaveBeenCalledWith({}, TENANT, {
      autoSync: { enabled: true, cadence: 'daily' },
    });
    expect(scheduleHuduAutoSyncJobMock).toHaveBeenCalledWith(TENANT);
    expect(result).toEqual({ success: true, data: { enabled: true, cadence: 'daily' } });
  });

  it('requires system_settings:update', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { setHuduAutoSync } = await loadActions();
    await expect(setHuduAutoSync({ enabled: true })).rejects.toThrow(/insufficient permissions/);
    expect(mergeHuduSettingsMock).not.toHaveBeenCalled();
  });
});
