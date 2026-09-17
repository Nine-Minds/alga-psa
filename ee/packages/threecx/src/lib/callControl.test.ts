import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import { answerThreecxCall } from './callControl';
import type { ThreecxTokenStore } from './pbx/token';

const CREDS = { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 's' };
class FakeStore implements ThreecxTokenStore {
  async get() { return 'tok'; }
  async setWithTtl() {}
  async del() {}
  async acquireLock() { return true; }
  async releaseLock() {}
}

describe('answerThreecxCall', () => {
  it('posts to the participant answer endpoint on the caller extension', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response('{"finalstatus":"Success"}', { status: 200 });
    });
    await answerThreecxCall('t1', { dn: '100', participantId: '7' }, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() });
    expect(calls).toEqual([{ url: 'https://pbx.example.com/callcontrol/100/participants/7/answer', method: 'POST' }]);
  });

  it('refuses a blank extension or participant before touching the PBX', async () => {
    const fetchImpl = vi.fn();
    await expect(answerThreecxCall('t1', { dn: '', participantId: '7' }, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the PBX refusal', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"not under direct control"}', { status: 422 }));
    await expect(answerThreecxCall('t1', { dn: '100', participantId: '7' }, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() }))
      .rejects.toMatchObject({ status: 422 });
  });
});
