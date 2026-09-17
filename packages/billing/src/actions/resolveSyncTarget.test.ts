import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getStoredQboCredentialsMap, getStoredXeroConnections } = vi.hoisted(() => ({
  getStoredQboCredentialsMap: vi.fn(),
  getStoredXeroConnections: vi.fn()
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: vi.fn(),
  writeAccountingAudit: vi.fn()
}));

vi.mock('../services/accountingSync/connectedAccountingIntegration', () => ({
  resolveConnectedAccountingIntegration: vi.fn()
}));
vi.mock('../adapters/accounting/registry', () => ({
  AccountingAdapterRegistry: { createDefault: vi.fn() }
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap,
  QboClientService: {}
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections
}));
vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({
  isProviderDisconnectActive: vi.fn(async () => false),
  PROVIDER_QBO: 'qbo',
  PROVIDER_XERO: 'xero'
}));

import { resolveSyncTarget } from '../services/accountingSync/syncTarget';
import { resolveConnectedAccountingIntegration } from '../services/accountingSync/connectedAccountingIntegration';
import { AccountingAdapterRegistry } from '../adapters/accounting/registry';

const xeroAdapter = { type: 'xero', capabilities: () => ({}) };
const qboAdapter = { type: 'quickbooks_online', capabilities: () => ({}) };

describe('resolveSyncTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AccountingAdapterRegistry.createDefault).mockResolvedValue({
      get: vi.fn((type: string) => (type === 'xero' ? xeroAdapter : qboAdapter))
    } as any);
    vi.mocked(getStoredQboCredentialsMap).mockResolvedValue({});
    vi.mocked(getStoredXeroConnections).mockResolvedValue({});
  });

  it('selects the Xero connection id and its refresh expiry', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue({
      adapterType: 'xero',
      targetRealm: 'conn-42'
    });
    vi.mocked(getStoredXeroConnections).mockResolvedValue({
      'conn-42': { refreshTokenExpiresAt: '2026-10-01T00:00:00Z' }
    } as any);

    const target = await resolveSyncTarget({} as any, 'tenant-1');

    expect(target?.integration.adapterType).toBe('xero');
    expect(target?.integration.targetRealm).toBe('conn-42');
    expect(target?.adapter).toBe(xeroAdapter);
    expect(target?.refreshTokenExpiresAt).toBe('2026-10-01T00:00:00Z');
    expect(getStoredQboCredentialsMap).not.toHaveBeenCalled();
  });

  it('selects the QBO realm and its refresh expiry', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-7'
    });
    vi.mocked(getStoredQboCredentialsMap).mockResolvedValue({
      'realm-7': { refreshTokenExpiresAt: '2026-11-01T00:00:00Z' }
    } as any);

    const target = await resolveSyncTarget({} as any, 'tenant-1');

    expect(target?.integration.adapterType).toBe('quickbooks_online');
    expect(target?.adapter).toBe(qboAdapter);
    expect(target?.refreshTokenExpiresAt).toBe('2026-11-01T00:00:00Z');
    expect(getStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('returns null when no provider is connected', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue(null);
    expect(await resolveSyncTarget({} as any, 'tenant-1')).toBeNull();
  });
});
