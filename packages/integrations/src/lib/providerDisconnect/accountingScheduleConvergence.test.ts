import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDisconnectRecord = vi.hoisted(() => vi.fn());
const createDisconnectRecord = vi.hoisted(() => vi.fn());
const setRecordStatus = vi.hoisted(() => vi.fn());
const writeDisconnectAudit = vi.hoisted(() => vi.fn());
const hasAnyProviderCredentials = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({}),
}));

vi.mock('../accountingOAuthStateStore', () => ({
  invalidateAccountingOAuthStates: vi.fn(async () => undefined),
}));

vi.mock('./repository', () => ({
  getDisconnectRecord,
  createDisconnectRecord,
  deleteDisconnectRecord: vi.fn(),
  updateTargetOutcome: vi.fn(),
  setRecordStatus,
  replaceDisconnectTargets: vi.fn(),
}));

vi.mock('./lock', () => ({
  withProviderCredentialLock: vi.fn(async (_knex, _tenant, _provider, callback) => callback({})),
}));

vi.mock('./audit', () => ({
  writeDisconnectAudit,
  writeDisconnectAuditInTransaction: vi.fn(),
}));

vi.mock('./tombstone', () => ({
  tombstoneLiveCredentials: vi.fn(),
  clearTombstoneCredentials: vi.fn(),
  clearTombstoneCredentialsStrict: vi.fn(),
  tombstoneCredentialsSecretName: vi.fn(() => 'xero_tombstone'),
  hasAnyProviderCredentials,
  hasLiveProviderCredentials: vi.fn(),
}));

vi.mock('./revoker', () => ({
  revokeQboRealm: vi.fn(),
  revokeXeroConnection: vi.fn(),
  revokeXeroGrant: vi.fn(),
  readQboRevokeMaterial: vi.fn(async () => ({})),
  readXeroRevokeMaterial: vi.fn(async () => ({})),
  toXeroRevokeMaterial: vi.fn(),
}));

import { registerAccountingConnectionChangeHandler } from '../accountingConnectionChangeProvider';
import { disconnectProvider, forceFinalizeProviderDisconnect } from './service';
import { PROVIDER_XERO } from './types';

const HANDLER_KEY = Symbol.for('alga.integrations.accountingConnectionChangeHandler');
const EMPTY_FINAL_RECORD = {
  tenantId: 'tenant-1',
  provider: PROVIDER_XERO,
  status: 'finalized',
  targets: [],
  correlationId: 'correlation-1',
  attemptCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
  getDisconnectRecord.mockResolvedValue(null);
  createDisconnectRecord.mockResolvedValue(EMPTY_FINAL_RECORD);
  hasAnyProviderCredentials.mockResolvedValue(false);
});

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
});

describe('Xero disconnect schedule convergence', () => {
  it('converges a stale schedule when disconnect finds no credentials', async () => {
    const connectionChanged = vi.fn(async () => undefined);
    registerAccountingConnectionChangeHandler(connectionChanged);

    const result = await disconnectProvider({} as never, 'tenant-1', PROVIDER_XERO);

    expect(result.status).toBe('no_credentials');
    expect(setRecordStatus).toHaveBeenCalledWith(
      {},
      'tenant-1',
      PROVIDER_XERO,
      'finalized',
      expect.objectContaining({ finalizedAt: expect.any(String) }),
    );
    expect(writeDisconnectAudit).toHaveBeenCalled();
    expect(connectionChanged).toHaveBeenCalledWith('tenant-1');
  });

  it('converges a stale schedule when force-finalize finds no record', async () => {
    const connectionChanged = vi.fn(async () => undefined);
    registerAccountingConnectionChangeHandler(connectionChanged);

    const result = await forceFinalizeProviderDisconnect(
      {} as never,
      'tenant-1',
      PROVIDER_XERO,
      { reason: 'cleanup' },
    );

    expect(result.status).toBe('no_credentials');
    expect(connectionChanged).toHaveBeenCalledWith('tenant-1');
  });
});
