import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const resolveSyncTargetMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const countOperationsByStatusMock = vi.hoisted(() => vi.fn(async () => ({})));
const countLedgerByStatusMock = vi.hoisted(() => vi.fn(async () => ({})));
const getLatestCycleMock = vi.hoisted(() => vi.fn<() => Promise<{ error: string } | null>>(async () => null));
const countOpenMock = vi.hoisted(() => vi.fn(async () => 0));
const readAutoApplyMock = vi.hoisted(() => vi.fn(async () => null));
const qboCredentialsMock = vi.hoisted(() => vi.fn(async () => ({})));
const xeroConnectionsMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, { tenantName: string; accessTokenExpiresAt?: string }>>>(async () => ({
  'conn-1': { tenantName: 'Acme Org' }
})));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: tenantDbMock,
  writeAccountingAudit: vi.fn(async () => undefined)
}));

vi.mock('../services/accountingSync/syncTarget', () => ({
  resolveSyncTarget: resolveSyncTargetMock
}));
vi.mock('../services/accountingSync/syncMappingLedger', () => ({
  SyncMappingLedger: vi.fn().mockImplementation(function () {
    return { countByStatus: countLedgerByStatusMock };
  })
}));
vi.mock('../services/accountingSync/syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () {
    return { countByStatus: countOperationsByStatusMock };
  })
}));
vi.mock('../services/accountingSync/syncCycleRepository', () => ({
  SyncCycleRepository: vi.fn().mockImplementation(function () {
    return { getLatestCycle: getLatestCycleMock };
  })
}));
vi.mock('../services/accountingSync/syncExceptionService', () => ({
  WorkflowTaskSyncExceptionService: vi.fn().mockImplementation(function () {
    return { countOpen: countOpenMock };
  })
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: qboCredentialsMock,
  QboClientService: { create: vi.fn(), getPreferences: vi.fn() },
  getQboEnvironment: vi.fn(() => 'sandbox')
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: xeroConnectionsMock
}));
vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({
  isProviderDisconnectActive: vi.fn(async () => false),
  PROVIDER_QBO: 'qbo',
  PROVIDER_XERO: 'xero'
}));

import { getAccountingSyncHealth, getInvoiceSyncStatuses } from './accountingSyncActions';

const TENANT = 'tenant-org';
const USER = { user_id: 'u1', roles: [] } as any;

interface QueryRecord {
  table: string;
  wheres: unknown[];
  whereNulls: string[];
}

let queryRecords: QueryRecord[] = [];

function makeBuilder(table: string, rows: unknown[]): any {
  const record: QueryRecord = { table, wheres: [], whereNulls: [] };
  queryRecords.push(record);
  const builder: any = {};
  for (const method of ['select', 'orderBy', 'limit', 'from', 'andWhere', 'whereIn']) {
    builder[method] = () => builder;
  }
  builder.where = (arg: unknown, value?: unknown) => {
    if (typeof arg === 'string') {
      record.wheres.push({ [arg]: value });
    } else {
      record.wheres.push(arg);
    }
    return builder;
  };
  builder.whereNull = (column: string) => {
    record.whereNulls.push(column);
    return builder;
  };
  builder.first = async () => rows[0] ?? undefined;
  builder.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}

function xeroTarget() {
  return {
    integration: { adapterType: 'xero', targetRealm: 'conn-1' },
    adapter: {},
    refreshTokenExpiresAt: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  queryRecords = [];
  resolveSyncTargetMock.mockResolvedValue(xeroTarget());
  qboCredentialsMock.mockResolvedValue({});
  xeroConnectionsMock.mockResolvedValue({ 'conn-1': { tenantName: 'Acme Org' } });
  tenantDbMock.mockImplementation((_knex: unknown, _tenant: unknown) => ({
    table: (table: string) => makeBuilder(table, [])
  }));
  countOperationsByStatusMock.mockResolvedValue({});
  countLedgerByStatusMock.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('accounting sync actions organisation scoping', () => {
  it('scopes invoice status lookups to the selected organisation and excludes tombstones', async () => {
    tenantDbMock.mockImplementation((_knex: unknown, _tenant: unknown) => ({
      table: (table: string) =>
        makeBuilder(
          table,
          table === 'tenant_external_entity_mappings'
            ? [
                {
                  alga_entity_id: 'inv-1',
                  external_entity_id: 'xero-inv-1',
                  sync_status: 'synced',
                  last_synced_at: '2026-03-01T00:00:00.000Z',
                  metadata: { doc_number: 'XERO-INV-1' }
                }
              ]
            : []
        )
    }));

    const statuses = await (getInvoiceSyncStatuses as any)(USER, { tenant: TENANT }, ['inv-1']);

    expect(statuses['inv-1'].provider).toBe('xero');
    expect(statuses['inv-1'].externalId).toBe('xero-inv-1');
    expect(statuses['inv-1'].environment).toBeUndefined();

    const mappingQuery = queryRecords.find((r) => r.table === 'tenant_external_entity_mappings');
    const opsQuery = queryRecords.find((r) => r.table === 'accounting_sync_operations');
    expect(mappingQuery?.wheres).toContainEqual(expect.objectContaining({ integration_type: 'xero' }));
    expect(mappingQuery?.wheres).toContainEqual(expect.objectContaining({ external_realm_id: 'conn-1' }));
    expect(mappingQuery?.whereNulls).toContain('deleted_at');
    expect(opsQuery?.wheres).toContainEqual(expect.objectContaining({ adapter_type: 'xero' }));
    expect(opsQuery?.wheres).toContainEqual(expect.objectContaining({ target_realm: 'conn-1' }));
  });

  it('scopes health counts and provider label to the selected organisation', async () => {
    const selection = { preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1' };
    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, selection);

    expect(resolveSyncTargetMock).toHaveBeenCalledWith(expect.anything(), TENANT, selection);
    expect(health.adapterType).toBe('xero');
    expect(health.organisationName).toBe('Acme Org');
    expect(countOperationsByStatusMock).toHaveBeenCalledWith(TENANT, 'xero', 'conn-1');
    expect(countLedgerByStatusMock).toHaveBeenCalledWith('conn-1');
    expect(countOpenMock).toHaveBeenCalledWith('conn-1');
    expect(getLatestCycleMock).toHaveBeenCalledWith(TENANT, 'xero', 'conn-1');
  });

  it('keeps unavailable Xero health disconnected without querying another provider', async () => {
    resolveSyncTargetMock.mockResolvedValue(null);
    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, {
      preferredAdapterType: 'xero', preferredTargetRealm: 'removed'
    });
    expect(health).toMatchObject({ connected: false, adapterType: 'xero', lastCycle: null });
    expect(health.realms.every((realm: any) => !realm.isDefault)).toBe(true);
    expect(countOperationsByStatusMock).not.toHaveBeenCalled();
  });

  it('counts terminal failed operations alongside skipped, scoped to the organisation', async () => {
    countOperationsByStatusMock.mockResolvedValue({ pending: 1, in_progress: 2, skipped: 1, failed: 3 });
    const selection = { preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1' };

    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, selection);

    expect(countOperationsByStatusMock).toHaveBeenCalledWith(TENANT, 'xero', 'conn-1');
    expect(health.erroredOps).toBe(4); // 1 skipped + 3 failed
    expect(health.pendingOps).toBe(3); // 1 pending + 2 in_progress
  });

  it('clears a stale reconnect warning after OAuth stores a fresh Xero access token', async () => {
    getLatestCycleMock.mockResolvedValue({
      error: 'Xero refresh token was rejected; re-authentication is required'
    });
    xeroConnectionsMock.mockResolvedValue({
      'conn-1': {
        tenantName: 'Acme Org',
        accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }
    });

    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, {
      preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1'
    });

    expect(health.reconnectRequired).toBe(false);
  });

  it('keeps reconnect required when the failed Xero cycle still has no fresh access token', async () => {
    getLatestCycleMock.mockResolvedValue({
      error: 'Xero refresh token was rejected; re-authentication is required'
    });
    xeroConnectionsMock.mockResolvedValue({
      'conn-1': {
        tenantName: 'Acme Org',
        accessTokenExpiresAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
      }
    });

    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, {
      preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1'
    });

    expect(health.reconnectRequired).toBe(true);
  });

  it('marks the explicitly selected QBO realm as the health target', async () => {
    qboCredentialsMock.mockResolvedValue({ 'realm-1': {}, 'realm-2': {} });
    resolveSyncTargetMock.mockResolvedValue({ integration: { adapterType: 'quickbooks_online', targetRealm: 'realm-2' } });
    const health = await (getAccountingSyncHealth as any)(USER, { tenant: TENANT }, {
      preferredAdapterType: 'quickbooks_online', preferredTargetRealm: 'realm-2'
    });
    expect(health.realms).toEqual([{ realmId: 'realm-1', isDefault: false }, { realmId: 'realm-2', isDefault: true }]);
    expect(countOperationsByStatusMock).toHaveBeenCalledWith(TENANT, 'quickbooks_online', 'realm-2');
  });
});
