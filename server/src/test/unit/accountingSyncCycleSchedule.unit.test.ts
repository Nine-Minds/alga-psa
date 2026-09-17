import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveConnectedAccountingIntegrationMock = vi.fn();
const scheduleRecurringJobMock = vi.fn();
const cancelJobMock = vi.fn();
const firstMock = vi.fn();
const runCycleMock = vi.fn();
const xeroConnectionsMock = vi.fn();
const isProviderDisconnectActiveMock = vi.fn();
const getConnectionMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: (...a: unknown[]) => runWithTenantMock(...a) }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: (...a: unknown[]) => getConnectionMock(...a) }));
vi.mock('@alga-psa/billing/services', () => ({
  runAccountingSyncCycle: (...a: unknown[]) => runCycleMock(...a),
  AccountingAdapterRegistry: {
    createDefault: vi.fn(async () => ({ get: () => ({ type: 'xero', capabilities: () => ({}) }) }))
  },
  resolveConnectedAccountingIntegration: (...a: unknown[]) => resolveConnectedAccountingIntegrationMock(...a),
}));
const qboCredentialsMock = vi.fn(async () => ({} as Record<string, any>));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: (...a: unknown[]) => qboCredentialsMock(...a),
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: (...a: unknown[]) => xeroConnectionsMock(...a),
}));
vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({
  isProviderDisconnectActive: (...a: unknown[]) => isProviderDisconnectActiveMock(...a),
  PROVIDER_QBO: 'qbo',
  PROVIDER_XERO: 'xero',
}));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({
    scheduleRecurringJob: (...a: unknown[]) => scheduleRecurringJobMock(...a),
    cancelJob: (...a: unknown[]) => cancelJobMock(...a),
  }),
}));

// admin knex query builder used by cancelAccountingSyncCycle
const queryBuilder = {
  where: () => queryBuilder,
  whereRaw: () => queryBuilder,
  whereNotNull: () => queryBuilder,
  orderBy: () => queryBuilder,
  first: (...a: unknown[]) => firstMock(...a),
};
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => () => queryBuilder,
}));

import { scheduleAccountingSyncCycleJob, accountingSyncCycleHandler } from '@/lib/jobs/handlers/accountingSyncCycleHandler';

describe('accountingSyncCycleHandler scheduled targets', () => {
  beforeEach(() => {
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    resolveConnectedAccountingIntegrationMock.mockReset();
    runCycleMock.mockReset();
    runCycleMock.mockResolvedValue({ ran: true, status: 'succeeded' });
    xeroConnectionsMock.mockReset();
    isProviderDisconnectActiveMock.mockReset();
    isProviderDisconnectActiveMock.mockResolvedValue(false);
    getConnectionMock.mockReset();
    getConnectionMock.mockResolvedValue({});
    qboCredentialsMock.mockReset();
    qboCredentialsMock.mockResolvedValue({});
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, cb: () => Promise<void>) => cb());
  });

  it('runs a cycle for EVERY connected Xero organisation, not just the selected one', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue({
      adapterType: 'xero',
      targetRealm: 'conn-1',
    });
    xeroConnectionsMock.mockResolvedValue({
      'conn-1': { refreshTokenExpiresAt: '2026-05-01T00:00:00.000Z' },
      'conn-2': { refreshTokenExpiresAt: '2026-06-01T00:00:00.000Z' },
    });

    await accountingSyncCycleHandler({ tenantId: 't1' } as any);

    expect(runCycleMock).toHaveBeenCalledTimes(2);
    const realms = runCycleMock.mock.calls.map((call) => call[0].targetRealm).sort();
    expect(realms).toEqual(['conn-1', 'conn-2']);
  });

  it('processes both connected providers, not only the resolver-selected one', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-1'
    });
    qboCredentialsMock.mockResolvedValue({ 'realm-1': {} });
    xeroConnectionsMock.mockResolvedValue({ 'conn-9': {} });

    await accountingSyncCycleHandler({ tenantId: 't1' } as any);

    expect(runCycleMock).toHaveBeenCalledTimes(2);
    const adapters = runCycleMock.mock.calls.map((call) => call[0].adapterType).sort();
    expect(adapters).toEqual(['quickbooks_online', 'xero']);
  });
});

describe('scheduleAccountingSyncCycleJob (connected-only)', () => {
  beforeEach(() => {
    // Pin BOTH edition env vars so the isEnterpriseEdition() guard is deterministic
    // even if an earlier test file leaks NEXT_PUBLIC_EDITION into the worker.
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    resolveConnectedAccountingIntegrationMock.mockReset();
    scheduleRecurringJobMock.mockReset();
    cancelJobMock.mockReset();
    firstMock.mockReset();
    scheduleRecurringJobMock.mockResolvedValue({ jobId: 'job-1', externalId: 'accounting-sync-cycle:t1' });
    cancelJobMock.mockResolvedValue(true);
  });

  it('schedules a connected tenant', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-123',
    });

    const result = await scheduleAccountingSyncCycleJob('t1');

    expect(scheduleRecurringJobMock).toHaveBeenCalledTimes(1);
    expect(scheduleRecurringJobMock).toHaveBeenCalledWith(
      'accounting-sync-cycle',
      { tenantId: 't1' },
      '*/15 * * * *',
      { singletonKey: 'accounting-sync-cycle:t1' },
    );
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBe('job-1');
  });

  it('schedules a Xero-only tenant', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue({
      adapterType: 'xero',
      targetRealm: 'conn-123',
    });

    const result = await scheduleAccountingSyncCycleJob('t-xero');

    expect(scheduleRecurringJobMock).toHaveBeenCalledWith(
      'accounting-sync-cycle',
      { tenantId: 't-xero' },
      '*/15 * * * *',
      { singletonKey: 'accounting-sync-cycle:t-xero' },
    );
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBe('job-1');
  });

  it('does NOT schedule an unconnected tenant, and cancels a stray schedule', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue(null);
    firstMock.mockResolvedValue({ job_id: 'stale-job' }); // a leftover schedule exists

    const result = await scheduleAccountingSyncCycleJob('t2');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).toHaveBeenCalledWith('stale-job', 't2');
    expect(result).toBeNull();
  });

  it('unconnected with no existing schedule is a no-op', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue(null);
    firstMock.mockResolvedValue(undefined);

    const result = await scheduleAccountingSyncCycleJob('t3');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null in CE without touching the runner', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
    const result = await scheduleAccountingSyncCycleJob('t4');
    expect(resolveConnectedAccountingIntegrationMock).not.toHaveBeenCalled();
    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
