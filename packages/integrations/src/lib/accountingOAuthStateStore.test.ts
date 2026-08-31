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
  storeAccountingOAuthNonce,
} from './accountingOAuthStateStore';

describe('accounting OAuth nonce store (memory fallback)', () => {
  beforeEach(() => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
  });

  it('allows the first consume of a nonce and rejects the second (replay)', async () => {
    await storeAccountingOAuthNonce('qbo', 'nonce-1');

    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toBe(true);
    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toBe(false);
  });

  it('rejects an unknown nonce', async () => {
    expect(await consumeAccountingOAuthNonce('qbo', 'never-stored')).toBe(false);
  });

  it('scopes nonces per provider: a qbo nonce cannot be consumed as xero', async () => {
    await storeAccountingOAuthNonce('qbo', 'nonce-1');

    expect(await consumeAccountingOAuthNonce('xero', 'nonce-1')).toBe(false);
    expect(await consumeAccountingOAuthNonce('qbo', 'nonce-1')).toBe(true);
  });
});
