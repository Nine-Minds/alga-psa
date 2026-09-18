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
  consumeXeroConnectAttempt,
  storeXeroConnectAttempt,
  _resetXeroConnectAttemptStoreForTests,
  _peekXeroConnectAttemptForTests,
  XERO_CONNECT_ATTEMPT_PROVIDER
} from './xeroOAuthConnectAttemptStore';

function makeAttempt(overrides: Record<string, unknown> = {}): any {
  return {
    verifier: 'enc:c2VjcmV0LXZlcmlmaWVy',
    tenantId: 'tenant-1',
    userId: 'user-1',
    provider: XERO_CONNECT_ATTEMPT_PROVIDER,
    redirectUri: 'https://example.com/api/integrations/xero/callback',
    csrf: 'a'.repeat(64),
    createdAt: Date.now(),
    expiresAt: Date.now() + 600 * 1000,
    ...overrides,
  };
}

describe('Xero connect attempt store', () => {
  beforeEach(() => {
    _resetXeroConnectAttemptStoreForTests();
    mocks.createClient.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
  });

  describe('memory fallback', () => {
    it('returns the stored attempt exactly once and rejects a replay', async () => {
      await storeXeroConnectAttempt('nonce-1', makeAttempt());

      const first = await consumeXeroConnectAttempt('nonce-1');
      expect(first).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1' });

      expect(await consumeXeroConnectAttempt('nonce-1')).toBeNull();
    });

    it('rejects an unknown nonce', async () => {
      expect(await consumeXeroConnectAttempt('never-stored')).toBeNull();
    });

    it('rejects an expired attempt at consume time', async () => {
      await storeXeroConnectAttempt('nonce-1', makeAttempt(), 600);
      const future = Date.now() + 601 * 1000;

      expect(await consumeXeroConnectAttempt('nonce-1', { now: future })).toBeNull();
    });

    it('peeks a stored attempt without consuming it', async () => {
      await storeXeroConnectAttempt('nonce-1', makeAttempt());

      expect(_peekXeroConnectAttemptForTests('nonce-1')).toMatchObject({ tenantId: 'tenant-1' });
      expect(await consumeXeroConnectAttempt('nonce-1')).not.toBeNull();
      expect(_peekXeroConnectAttemptForTests('nonce-1')).toBeNull();
    });

    it('keys attempts by nonce so parallel attempts do not collide', async () => {
      await storeXeroConnectAttempt('nonce-a', makeAttempt({ userId: 'user-a' }));
      await storeXeroConnectAttempt('nonce-b', makeAttempt({ userId: 'user-b' }));

      expect(await consumeXeroConnectAttempt('nonce-a')).toMatchObject({ userId: 'user-a' });
      expect(await consumeXeroConnectAttempt('nonce-b')).toMatchObject({ userId: 'user-b' });
    });
  });

  describe('Redis path', () => {
    it('consumes atomically via GETDEL and rejects a replay', async () => {
      const redisData = new Map<string, string>();
      const fakeClient = {
        connect: async () => {},
        on: () => {},
        set: async (key: string, value: string) => {
          redisData.set(key, value);
          return 'OK';
        },
        getDel: async (key: string) => {
          const value = redisData.get(key);
          redisData.delete(key);
          return value ?? null;
        },
      };
      mocks.createClient.mockReturnValue(fakeClient as any);

      await storeXeroConnectAttempt('nonce-redis', makeAttempt());

      expect(await consumeXeroConnectAttempt('nonce-redis')).toMatchObject({ tenantId: 'tenant-1' });
      expect(await consumeXeroConnectAttempt('nonce-redis')).toBeNull();
    });
  });
});
