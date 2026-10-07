import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveConnectedAccountingIntegrationMock = vi.fn();
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
  resolveConnectedAccountingIntegration: (...a: unknown[]) => resolveConnectedAccountingIntegrationMock(...a),
  AccountingAdapterRegistry: {
    createDefault: vi.fn(async () => ({ get: () => ({ type: 'xero', capabilities: () => ({}) }) }))
  },
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
import { accountingSyncCycleHandler } from '@/lib/jobs/handlers/accountingSyncCycleHandler';

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
