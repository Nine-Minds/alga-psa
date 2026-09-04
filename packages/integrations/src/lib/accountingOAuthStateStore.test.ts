import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => null,
  }),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisConfig: () => ({ url: 'redis://localhost:6379' }),
}));

import {
  consumeAccountingOAuthNonce,
  invalidateAccountingOAuthStates,
  storeAccountingOAuthNonce,
} from './accountingOAuthStateStore';

const record = (tenantId = 'tenant-1') => ({
  tenantId,
  initiatedAt: '2026-08-31T12:00:00.000Z',
});

describe('accounting OAuth nonce store (memory fallback)', () => {
  beforeEach(() => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
  });

  it('allows the first consume of a nonce and rejects the second (replay)', async () => {
    await storeAccountingOAuthNonce('qbo', 'nonce-1', record());

    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toEqual(record());
    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toBeNull();
  });

  it('rejects an unknown nonce', async () => {
    expect(await consumeAccountingOAuthNonce('qbo', 'never-stored')).toBeNull();
  });

  it('scopes nonces per provider: a qbo nonce cannot be consumed as xero', async () => {
    await storeAccountingOAuthNonce('qbo', 'nonce-1', record());

    expect(await consumeAccountingOAuthNonce('xero', 'nonce-1')).toBeNull();
    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toEqual(record());
  });

  it('invalidates all outstanding states for only the selected tenant and provider', async () => {
    await storeAccountingOAuthNonce('qbo', 'tenant-1-a', record('tenant-1'));
    await storeAccountingOAuthNonce('qbo', 'tenant-1-b', record('tenant-1'));
    await storeAccountingOAuthNonce('qbo', 'tenant-2', record('tenant-2'));
    await storeAccountingOAuthNonce('xero', 'tenant-1-xero', record('tenant-1'));

    await invalidateAccountingOAuthStates('qbo', 'tenant-1');

    expect(await consumeAccountingOAuthNonce('qbo', 'tenant-1-a')).toBeNull();
    expect(await consumeAccountingOAuthNonce('qbo', 'tenant-1-b')).toBeNull();
    expect(await consumeAccountingOAuthNonce('qbo', 'tenant-2')).toEqual(record('tenant-2'));
    expect(await consumeAccountingOAuthNonce('xero', 'tenant-1-xero')).toEqual(record('tenant-1'));
  });
});
