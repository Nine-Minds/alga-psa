import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkInboundReopenRateLimit,
  type InboundReopenRedisClient,
} from './inboundReopenRateLimiter';

/** In-memory stand-in for the node-redis client (INCR/EXPIRE/TTL). */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const client: InboundReopenRedisClient & { expireCalls: number } = {
    expireCalls: 0,
    async incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire(key: string, seconds: number) {
      client.expireCalls += 1;
      ttls.set(key, seconds);
      return true;
    },
    async ttl(key: string) {
      return ttls.has(key) ? (ttls.get(key) as number) : -1;
    },
  };
  return client;
}

describe('checkInboundReopenRateLimit', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.INBOUND_REOPEN_RATELIMIT_MAX = '3';
    process.env.INBOUND_REOPEN_RATELIMIT_WINDOW_SECONDS = '3600';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('allows up to the configured limit then denies', async () => {
    const redis = fakeRedis();
    const getter = async () => redis;
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
    expect(results[0]).toMatchObject({ limit: 3, windowSeconds: 3600 });
  });

  it('sets the window TTL once on the first reopen', async () => {
    const redis = fakeRedis();
    const getter = async () => redis;
    await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    expect(redis.expireCalls).toBe(1);
  });

  it('counts each ticket independently', async () => {
    const redis = fakeRedis();
    const getter = async () => redis;
    await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    const other = await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k2', redisClientGetter: getter });
    expect(other).toMatchObject({ allowed: true, count: 1 });
  });

  it('repairs a missing TTL defensively so a key cannot become permanent', async () => {
    const redis = fakeRedis();
    // Simulate a key that exists with no TTL (e.g. a lost EXPIRE).
    await redis.incr('alga:inbound-reopen-rl:t1:k1');
    const getter = async () => redis;
    await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    expect(redis.expireCalls).toBe(1);
  });

  it('fails open when Redis errors (never blocks a legitimate reopen)', async () => {
    const getter = async (): Promise<InboundReopenRedisClient> => ({
      async incr() {
        throw new Error('redis down');
      },
      async expire() {
        return true;
      },
      async ttl() {
        return -1;
      },
    });
    const result = await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(-1);
  });

  it('honors configured limit/window overrides', async () => {
    process.env.INBOUND_REOPEN_RATELIMIT_MAX = '1';
    const redis = fakeRedis();
    const getter = async () => redis;
    const first = await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    const second = await checkInboundReopenRateLimit({ tenantId: 't1', ticketId: 'k1', redisClientGetter: getter });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
