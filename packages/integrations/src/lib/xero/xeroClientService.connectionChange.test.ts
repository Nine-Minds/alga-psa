import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantSecret = vi.hoisted(() => vi.fn());
const setTenantSecret = vi.hoisted(() => vi.fn());
const retireTerminalDisconnectRecord = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret,
    setTenantSecret,
  }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => ({
      select: () => ({ first: async () => undefined }),
    }),
  }),
}));

vi.mock('../providerDisconnect/lock', () => ({
  getProviderCredentialWriteDisposition: vi.fn(async () => 'allowed'),
  withProviderCredentialLock: vi.fn(async (_knex, _tenant, _provider, callback) => callback({})),
}));

vi.mock('../providerDisconnect/retire', () => ({
  retireTerminalDisconnectRecord,
}));

import {
  registerAccountingConnectionChangeHandler,
} from '../accountingConnectionChangeProvider';
import {
  upsertStoredXeroConnections,
  XERO_CREDENTIALS_SECRET_NAME,
} from './xeroClientService';

const HANDLER_KEY = Symbol.for('alga.integrations.accountingConnectionChangeHandler');
const CONNECTION = {
  connectionId: 'conn-1',
  xeroTenantId: 'org-1',
  tenantName: 'Org One',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-09-16T12:00:00.000Z',
  refreshTokenExpiresAt: '2026-11-16T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
  getTenantSecret.mockResolvedValue(null);
  setTenantSecret.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
});

describe('Xero connection schedule convergence', () => {
  it('notifies after a newly connected organisation is stored durably', async () => {
    const connectionChanged = vi.fn(async () => undefined);
    registerAccountingConnectionChangeHandler(connectionChanged);

    await upsertStoredXeroConnections('tenant-1', { 'conn-1': CONNECTION });

    expect(setTenantSecret).toHaveBeenCalledWith(
      'tenant-1',
      XERO_CREDENTIALS_SECRET_NAME,
      JSON.stringify({ 'conn-1': CONNECTION }),
    );
    expect(retireTerminalDisconnectRecord).toHaveBeenCalledWith('tenant-1', 'xero', {});
    expect(connectionChanged).toHaveBeenCalledWith('tenant-1');
    expect(setTenantSecret.mock.invocationCallOrder[0]).toBeLessThan(
      connectionChanged.mock.invocationCallOrder[0],
    );
  });

  it('does not notify when connection persistence fails', async () => {
    const connectionChanged = vi.fn(async () => undefined);
    registerAccountingConnectionChangeHandler(connectionChanged);
    setTenantSecret.mockRejectedValue(new Error('secret store unavailable'));

    await expect(
      upsertStoredXeroConnections('tenant-1', { 'conn-1': CONNECTION }),
    ).rejects.toThrow('secret store unavailable');
    expect(connectionChanged).not.toHaveBeenCalled();
  });
});
