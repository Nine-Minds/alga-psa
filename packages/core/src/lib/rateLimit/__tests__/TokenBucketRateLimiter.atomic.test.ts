import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TokenBucketRateLimiter,
  type RateLimitResult,
  type TokenBucketRedisClient,
} from '../TokenBucketRateLimiter';

/**
 * The `get`/`set` methods must never be exercised by the atomic consume path:
 * check + consume + TTL must be a single EVAL round trip.
 */
function createMockRedis(opts: {
  hasEval?: boolean;
  eval?: () => Promise<unknown>;
} = {}): TokenBucketRedisClient {
  const base = {
    async get() {
      throw new Error('GET must not be used by the atomic consume path');
    },
    async set() {
      throw new Error('SET must not be used by the atomic consume path');
    },
  };
  if (opts.hasEval === false) {
    return base;
  }
  return {
    ...base,
    eval: vi.fn(opts.eval ?? (async () => [1, 10, 0])),
  };
}

describe('TokenBucketRateLimiter.tryConsumeAtomic', () => {
  beforeEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  it('consumes through a single EVAL round trip (never GET/SET) and maps the reply', async () => {
    const redis = createMockRedis({ eval: vi.fn(async () => [1, 4, 0]) });
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      api: async () => ({ maxTokens: 5, refillRate: 1 }),
    });

    const result = await limiter.tryConsumeAtomic('api', 't1', 'sub1');

    expect(result).toEqual({ allowed: true, remaining: 4 });
    const evalFn = redis.eval as ReturnType<typeof vi.fn>;
    expect(evalFn).toHaveBeenCalledTimes(1);
    const [script, options] = evalFn.mock.calls[0];
    expect(script).toContain('cjson.decode');
    expect(script).toContain("redis.call('SET', key, cjson.encode({ tokens = remaining, lastRefillMs = nowMs }), 'EX', ttlSeconds)");
    expect(script).toContain("redis.call('SET', key, cjson.encode({ tokens = tokens, lastRefillMs = nowMs }), 'EX', ttlSeconds)");
    expect(options.keys).toEqual(['alga-psa:ratelimit:bucket:api:t1:sub1']);
    expect(options.arguments[0]).toBe('5'); // maxTokens
    expect(options.arguments[1]).toBe('1'); // refillRate (tokens/second)
    expect(options.arguments[2]).toBe('1'); // tokens requested
    expect(options.arguments[4]).toBe('3600'); // bucket TTL
  });

  it('denies with retryAfterMs when the script reports an exhausted bucket', async () => {
    const redis = createMockRedis({ eval: vi.fn(async () => [0, 0, 2500]) });
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      api: async () => ({ maxTokens: 1, refillRate: 1 }),
    });

    const result = await limiter.tryConsumeAtomic('api', 't1', 'sub1');

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 2500 });
    expect(redis.eval as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('reports the fail-open sentinel when Redis is unavailable', async () => {
    const limiter = TokenBucketRateLimiter.getInstance();

    expect(await limiter.tryConsumeAtomic('api', 't1', 'sub1')).toEqual({
      allowed: true,
      remaining: -1,
    });
  });

  it('reports the fail-open sentinel when the client does not support EVAL', async () => {
    const redis = createMockRedis({ hasEval: false });
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {});

    expect(await limiter.tryConsumeAtomic('api', 't1', 'sub1')).toEqual({
      allowed: true,
      remaining: -1,
    });
  });

  it('reports the fail-open sentinel when EVAL errors or returns a malformed reply', async () => {
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(
      async () =>
        createMockRedis({
          eval: vi.fn(async () => {
            throw new Error('redis down');
          }),
        }),
      {},
    );
    expect(await limiter.tryConsumeAtomic('api', 't1')).toEqual({ allowed: true, remaining: -1 });

    TokenBucketRateLimiter.resetInstance();
    const badReplyLimiter = TokenBucketRateLimiter.getInstance();
    await badReplyLimiter.initialize(
      async () => createMockRedis({ eval: vi.fn(async () => 'not-an-array') }),
      {},
    );
    expect(await badReplyLimiter.tryConsumeAtomic('api', 't1')).toEqual({
      allowed: true,
      remaining: -1,
    });
  });
});

describe('TokenBucketRateLimiter.tryConsumeAtomic concurrency (live Redis)', () => {
  const REDIS_URL = process.env.EXT_GATEWAY_RATE_LIMIT_TEST_REDIS || 'redis://127.0.0.1:6381';
  const BUCKET_KEY = 'alga-psa:ratelimit:bucket:ext-gw:tenant-a:registry-1';
  const BUCKET_CAPACITY = 20;

  let client: {
    del: (key: string) => Promise<unknown>;
    disconnect: () => Promise<void>;
    eval?: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
  } | null = null;

  beforeAll(async () => {
    try {
      const { createClient } = await import('redis');
      const candidate = createClient({ url: REDIS_URL });
      candidate.on('error', () => undefined);
      await candidate.connect();
      if (typeof (candidate as any).ping !== 'function') {
        throw new Error('redis client lacks ping (test stub); use REAL_REDIS=1 for a live client');
      }
      await (candidate as any).ping();
      client = candidate as typeof client;
    } catch (error) {
      client = null;
    }
  }, 15000);

  afterAll(async () => {
    await client?.disconnect().catch(() => undefined);
  });

  it('allows exactly the bucket capacity under concurrent fire, never more', async () => {
    if (!client) {
      // No reachable Redis (CI / no REAL_REDIS): the mock-level single-EVAL
      // assertions above still pin the atomic contract.
      return;
    }

    TokenBucketRateLimiter.resetInstance();
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => client as unknown as TokenBucketRedisClient, {
      // Negligible refill so the burst cannot cross the capacity on a slow host.
      'ext-gw': async () => ({ maxTokens: BUCKET_CAPACITY, refillRate: 0.01 }),
    });

    await client.del(BUCKET_KEY);

    const requests = BUCKET_CAPACITY * 3;
    const results: RateLimitResult[] = await Promise.all(
      Array.from({ length: requests }, () => limiter.tryConsumeAtomic('ext-gw', 'tenant-a', 'registry-1')),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const sentinel = results.filter((r) => r.remaining < 0).length;

    expect(allowed).toBe(BUCKET_CAPACITY);
    expect(allowed).toBeLessThanOrEqual(BUCKET_CAPACITY);
    expect(sentinel).toBe(0);
  });
});
