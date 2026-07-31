/**
 * runHuduTenantSync — the tenant-wide import+sync engine shared by the
 * config-screen actions and the daily auto-sync job. The per-client import/sync
 * cores, the mapping enumeration and the status writer are faked; the loop,
 * summary accumulation, audit-user resolution and run-status writes are REAL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-tsync';
const CLIENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const createTenantKnexMock = vi.fn();
const getHuduCompanyMappingRowsMock = vi.fn();
const importUnmatchedCoreMock = vi.fn();
const syncCoreMock = vi.fn();
const setSyncRunStateMock = vi.fn();

// users-table lookup for the audit-user resolver
let internalUsers: Array<{ user_id: string }> = [];
let anyUsers: Array<{ user_id: string }> = [];
const knexMock = vi.fn((_table: string) => {
  const qb: Record<string, any> = {};
  let filteredInternal = false;
  qb.where = vi.fn((arg: Record<string, unknown>) => {
    if (arg && (arg as any).user_type === 'internal') filteredInternal = true;
    return qb;
  });
  qb.orderBy = vi.fn(() => qb);
  qb.first = vi.fn(async () => (filteredInternal ? internalUsers[0] : anyUsers[0]));
  return qb;
});

vi.mock('server/src/lib/db', () => ({ createTenantKnex: createTenantKnexMock }));
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduCompanyMappingRows: getHuduCompanyMappingRowsMock,
}));
vi.mock('@ee/lib/integrations/hudu/assetImportCore', () => ({
  importUnmatchedHuduAssetsCore: importUnmatchedCoreMock,
}));
vi.mock('@ee/lib/integrations/hudu/assetSyncCore', () => ({
  syncHuduClientAssetsCore: syncCoreMock,
}));
vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  setHuduSyncRunState: setSyncRunStateMock,
}));

async function loadTenantSync() {
  return import('@ee/lib/integrations/hudu/tenantSync');
}

beforeEach(() => {
  vi.clearAllMocks();
  internalUsers = [{ user_id: 'audit-user' }];
  anyUsers = [{ user_id: 'audit-user' }];
  createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: TENANT });
  getHuduCompanyMappingRowsMock.mockResolvedValue([
    { alga_entity_id: CLIENT_A },
    { alga_entity_id: CLIENT_B },
  ]);
  importUnmatchedCoreMock.mockResolvedValue({
    success: true,
    data: { created: 2, skipped: 1, failed: [] },
  });
  syncCoreMock.mockResolvedValue({ state: 'ok', updated: 1, unchanged: 0, stale: 0, rmmSkipped: 0, syncedAt: 'x' });
  setSyncRunStateMock.mockResolvedValue(undefined);
});

describe('runHuduTenantSync', () => {
  it('imports + syncs every mapped client and accumulates the summary', async () => {
    const { runHuduTenantSync } = await loadTenantSync();

    const summary = await runHuduTenantSync(TENANT, { importNew: true, actorUserId: 'clicker' });

    // import + sync called once per mapped client, with the supplied actor
    expect(importUnmatchedCoreMock).toHaveBeenCalledTimes(2);
    expect(importUnmatchedCoreMock).toHaveBeenCalledWith(TENANT, 'clicker', CLIENT_A);
    expect(syncCoreMock).toHaveBeenCalledTimes(2);
    expect(syncCoreMock).toHaveBeenCalledWith(TENANT, 'clicker', CLIENT_B);

    expect(summary).toMatchObject({
      sync_type: 'import',
      clients: 2,
      items_created: 4, // 2 per client
      items_updated: 2, // 1 per client
      items_skipped: 2, // 1 per client
      items_failed: 0,
      errors: [],
    });

    // status: syncing first, then completed with the summary + a timestamp
    expect(setSyncRunStateMock).toHaveBeenCalledWith(knexMock, TENANT, { status: 'syncing' });
    const last = setSyncRunStateMock.mock.calls.at(-1)?.[2];
    expect(last).toMatchObject({ status: 'completed', error: null });
    expect(last.lastFullSyncAt).toEqual(expect.any(String));
  });

  it('refresh-only (importNew=false) never calls the import core', async () => {
    const { runHuduTenantSync } = await loadTenantSync();

    const summary = await runHuduTenantSync(TENANT, { importNew: false, actorUserId: 'clicker' });

    expect(importUnmatchedCoreMock).not.toHaveBeenCalled();
    expect(syncCoreMock).toHaveBeenCalledTimes(2);
    expect(summary.sync_type).toBe('sync');
    expect(summary.items_updated).toBe(2);
  });

  it('records per-client errors without aborting and still completes', async () => {
    importUnmatchedCoreMock
      .mockResolvedValueOnce({ success: false, error: 'rate limited', code: 'rate_limited', partial: { created: 1, skipped: 0, failed: [] } })
      .mockResolvedValueOnce({ success: true, data: { created: 3, skipped: 0, failed: [] } });
    const { runHuduTenantSync } = await loadTenantSync();

    const summary = await runHuduTenantSync(TENANT, { importNew: true, actorUserId: 'clicker' });

    expect(summary.items_created).toBe(4); // 1 partial + 3
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain('rate limited');
    // The run still finishes (errors are reported in sync_error, status completed).
    const last = setSyncRunStateMock.mock.calls.at(-1)?.[2];
    expect(last.status).toBe('completed');
    expect(last.error).toContain('rate limited');
  });

  it('resolves the audit user (first internal user) when none is supplied', async () => {
    const { runHuduTenantSync } = await loadTenantSync();

    await runHuduTenantSync(TENANT, { importNew: true });

    expect(importUnmatchedCoreMock).toHaveBeenCalledWith(TENANT, 'audit-user', CLIENT_A);
  });

  it('fails closed when the tenant has no user to attribute writes to', async () => {
    internalUsers = [];
    anyUsers = [];
    const { runHuduTenantSync } = await loadTenantSync();

    const summary = await runHuduTenantSync(TENANT, { importNew: true });

    expect(importUnmatchedCoreMock).not.toHaveBeenCalled();
    expect(summary.errors[0]).toMatch(/No tenant user/);
    const last = setSyncRunStateMock.mock.calls.at(-1)?.[2];
    expect(last.status).toBe('error');
  });
});
