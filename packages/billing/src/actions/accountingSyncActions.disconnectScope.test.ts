import { describe, expect, it, vi, beforeEach } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const qboCredentialsMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, any>>>(async () => ({})));
const xeroConnectionsMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, any>>>(async () => ({})));
const activeMock = vi.hoisted(() => vi.fn(async (_k: unknown, _t: string, _p: string) => false));
const recordMock = vi.hoisted(() => vi.fn(async (_k: unknown, _t: string, _p: string): Promise<any> => null));
const runCycleMock = vi.hoisted(() => vi.fn(async () => ({ ran: true, status: 'succeeded' })));
const enqueueMock = vi.hoisted(() => vi.fn(async () => ({})));
const settingsMock = vi.hoisted(() => vi.fn(async () => ({ defaultRealm: null })));
const defaultRealmMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant-A' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { marker: 'knex' } })),
  // queueInvoiceSync reads the invoice status; a sendable invoice keeps these scope tests on the enqueue path.
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ first: async () => ({ status: 'sent' }) }) }) })),
  writeAccountingAudit: vi.fn(async () => undefined)
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: qboCredentialsMock,
  QboClientService: { create: vi.fn() },
  resolveTenantQboEnvironment: vi.fn()
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({ getStoredXeroConnections: xeroConnectionsMock }));
vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({
  isProviderDisconnectActive: activeMock,
  getDisconnectRecord: recordMock,
  PROVIDER_QBO: 'quickbooks_online',
  PROVIDER_XERO: 'xero',
  PROVIDER_TYPES: ['quickbooks_online', 'xero']
}));
vi.mock('../services/accountingSync/accountingSyncSettings', () => ({
  getAccountingSyncSettings: settingsMock,
  updateAccountingSyncSettings: vi.fn(),
  resolveDefaultRealm: defaultRealmMock
}));
vi.mock('../adapters/accounting/registry', () => ({
  AccountingAdapterRegistry: { createDefault: vi.fn(async () => ({ get: (t: string) => ({ type: t }) })) }
}));
vi.mock('../services/accountingSync/accountingSyncCycleService', () => ({ runAccountingSyncCycle: runCycleMock }));
vi.mock('../services/accountingSync/syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () { return { enqueue: enqueueMock }; })
}));
vi.mock('../services/accountingSync/syncCycleRepository', () => ({ SyncCycleRepository: vi.fn() }));
vi.mock('../services/accountingSync/syncMappingLedger', () => ({ SyncMappingLedger: vi.fn() }));
vi.mock('../services/accountingSync/syncExceptionService', () => ({ WorkflowTaskSyncExceptionService: vi.fn() }));

import { runAccountingSyncNow, queueInvoiceSync, resolveAccountingDriftReExport } from './accountingSyncActions';

type Provider = 'quickbooks_online' | 'xero';
let blocked: Set<Provider>;

const actions = {
  runAccountingSyncNow: (sel?: any) => (runAccountingSyncNow as any)(sel),
  queueInvoiceSync: (sel?: any) => (queueInvoiceSync as any)('inv-1', sel),
  resolveAccountingDriftReExport: (sel?: any) => (resolveAccountingDriftReExport as any)('inv-1', sel)
};
const wrote = () => runCycleMock.mock.calls.length + enqueueMock.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  blocked = new Set();
  hasPermissionMock.mockResolvedValue(true);
  qboCredentialsMock.mockResolvedValue({ 'realm-1': {}, 'realm-2': {} });
  xeroConnectionsMock.mockResolvedValue({ 'conn-1': {}, 'conn-2': {} });
  activeMock.mockImplementation(async (_k, _t, p) => blocked.has(p as Provider));
  recordMock.mockResolvedValue(null);
  defaultRealmMock.mockResolvedValue('realm-1');
});

describe.each(Object.keys(actions) as Array<keyof typeof actions>)('%s provider-scoped disconnect guard', (name) => {
  const run = actions[name];
  const adapterOf = () =>
    name === 'runAccountingSyncNow'
      ? (runCycleMock.mock.calls[0] as any)?.[0]
      : (enqueueMock.mock.calls[0] as any)?.[0];

  it.each([
    ['xero', { preferredAdapterType: 'quickbooks_online', preferredTargetRealm: 'realm-2' }, 'quickbooks_online', 'realm-2'],
    ['quickbooks_online', { preferredAdapterType: 'xero', preferredTargetRealm: 'conn-2' }, 'xero', 'conn-2']
  ] as const)('an unrelated %s disconnect permits the selected provider with tenant/provider/org intact', async (other, selection, provider, realm) => {
    blocked.add(other as Provider);
    await run(selection);
    const call = adapterOf();
    expect(call).toMatchObject({ adapterType: provider, targetRealm: realm });
    expect(call.tenant ?? call.tenantId).toBe('tenant-A');
  });

  it('an unrelated Xero disconnect permits the default (QuickBooks) path', async () => {
    blocked.add('xero');
    await run(undefined);
    expect(adapterOf()).toMatchObject({ adapterType: 'quickbooks_online', targetRealm: 'realm-1' });
  });

  it.each(['quickbooks_online', 'xero'] as const)('a same-provider (%s) disconnect writes no cycle and no queue row', async (provider) => {
    blocked.add(provider);
    const selection = provider === 'xero'
      ? { preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1' }
      : { preferredAdapterType: 'quickbooks_online', preferredTargetRealm: 'realm-1' };
    await expect(run(selection)).rejects.toThrow(provider === 'xero' ? /Xero is being disconnected/ : /QuickBooks is being disconnected/);
    expect(wrote()).toBe(0);
  });

  it.each([
    ['xero', /Xero is being disconnected/, { preferredAdapterType: 'xero', preferredTargetRealm: 'conn-1' }],
    ['quickbooks_online', /QuickBooks is being disconnected/, { preferredAdapterType: 'quickbooks_online' }]
  ] as const)('reports the %s disconnect when its credentials are tombstoned', async (provider, message, selection) => {
    blocked.add(provider);
    if (provider === 'xero') xeroConnectionsMock.mockResolvedValue({});
    else { qboCredentialsMock.mockResolvedValue({}); defaultRealmMock.mockResolvedValue(null); }
    await expect(run(selection)).rejects.toThrow(message);
    expect(wrote()).toBe(0);
  });

  it('reports the disconnect for a tombstoned explicit organisation selected without a provider', async () => {
    blocked.add('xero');
    xeroConnectionsMock.mockResolvedValue({});
    recordMock.mockImplementation(async (_k, _t, p) =>
      p === 'xero' ? { targets: [{ targetId: 'conn-1' }], status: 'failed_permanent' } : null);
    await expect(run({ preferredTargetRealm: 'conn-1' })).rejects.toThrow(/Xero is being disconnected/);
    expect(wrote()).toBe(0);
  });

  it('a missing explicit organisation never falls back to another organisation or provider', async () => {
    const result = await run({ preferredAdapterType: 'quickbooks_online', preferredTargetRealm: 'gone' });
    expect(wrote()).toBe(0);
    expect(JSON.stringify(result)).toMatch(/no longer connected/);
  });

  it('insufficient permission produces no cycle and no enqueue', async () => {
    hasPermissionMock.mockResolvedValue(false);
    await expect(run({ preferredAdapterType: 'quickbooks_online' })).rejects.toThrow('Forbidden');
    expect(wrote()).toBe(0);
    expect(activeMock).not.toHaveBeenCalled();
  });
});
