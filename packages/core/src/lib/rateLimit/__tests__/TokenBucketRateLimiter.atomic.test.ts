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
    expect(script).toContain("redis.call('DEL', key)");
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

  it('fails closed (denies) when EVAL throws or returns an error reply', async () => {
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
    expect(await limiter.tryConsumeAtomic('api', 't1')).toEqual({ allowed: false, remaining: -1 });
  });

  it('fails closed (denies) on malformed or partial EVAL replies', async () => {
    const malformedReplies: Array<unknown> = [
      'not-an-array',
      null,
      {},
      [1],
      [1, 4],
      [true, 4, 0],
      ['yes', 4, 0],
      [1, null, 0],
      [1, 4, 'oops'],
      [1, 4, -5],
      [1, -2, 0],
      [0, -5, 0],
      [2, 4, 0],
      [NaN, 4, 0],
      [Infinity, 4, 0],
    ];

    for (const reply of malformedReplies) {
      TokenBucketRateLimiter.resetInstance();
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => createMockRedis({ eval: vi.fn(async () => reply) }),
        { api: async () => ({ maxTokens: 5, refillRate: 1 }) },
      );
      expect(
        await limiter.tryConsumeAtomic('api', 't1'),
        `reply ${JSON.stringify(reply)} must deny`,
      ).toEqual({ allowed: false, remaining: -1 });
    }
  });

  it('fails closed (denies) when the bucket config is corrupt without calling EVAL', async () => {
    const redis = createMockRedis({ eval: vi.fn(async () => [1, 4, 0]) });
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(
      async () => redis,
      {
        api: async () => ({ maxTokens: NaN, refillRate: Infinity }),
      },
    );

    expect(await limiter.tryConsumeAtomic('api', 't1')).toEqual({ allowed: false, remaining: -1 });
    expect(redis.eval as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
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

describe('TokenBucketRateLimiter.tryConsumeAtomic corrupt state (live Redis)', () => {
  const REDIS_URL = process.env.EXT_GATEWAY_RATE_LIMIT_TEST_REDIS || 'redis://127.0.0.1:6381';
  const NAMESPACE = 'ext-gw-corrupt';
  const MAX_TOKENS = 20;

  interface CorruptClient {
    del: (key: string) => Promise<unknown>;
    set: (key: string, value: string) => Promise<unknown>;
    get: (key: string) => Promise<string | null>;
    pTTL: (key: string) => Promise<number>;
    disconnect: () => Promise<void>;
    eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
  }

  let client: CorruptClient | null = null;

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
      client = candidate as unknown as CorruptClient;
    } catch (error) {
      client = null;
    }
  }, 15000);

  afterAll(async () => {
    await client?.disconnect().catch(() => undefined);
  });

  async function makeLimiter() {
    TokenBucketRateLimiter.resetInstance();
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => client as unknown as TokenBucketRedisClient, {
      [NAMESPACE]: async () => ({ maxTokens: MAX_TOKENS, refillRate: 0.01 }),
    });
    return limiter;
  }

  async function seed(key: string, rawState: string) {
    await client!.del(key);
    await client!.set(key, rawState);
  }

  const bucketKey = `alga-psa:ratelimit:bucket:${NAMESPACE}:tenant-c:registry-1`;
  const now = () => Date.now();

  it.each([
    ['unparseable JSON', `{not json`, ''],
    ['wrong shape (array)', '[10, 100]', ''],
    ['missing tokens field', JSON.stringify({ lastRefillMs: now() }), ''],
    ['missing lastRefillMs field', JSON.stringify({ tokens: 5 }), ''],
    ['negative tokens', JSON.stringify({ tokens: -5, lastRefillMs: now() }), ''],
    ['tokens above capacity', JSON.stringify({ tokens: MAX_TOKENS + 100, lastRefillMs: now() }), ''],
    ['tokens above capacity (fractional)', JSON.stringify({ tokens: MAX_TOKENS + 0.5, lastRefillMs: now() }), ''],
    ['non-finite tokens (huge float)', `{"tokens": 1e400, "lastRefillMs": ${now()}}`, ''],
    ['zero refill timestamp', JSON.stringify({ tokens: 5, lastRefillMs: 0 }), ''],
    ['future refill timestamp', JSON.stringify({ tokens: 5, lastRefillMs: now() + 60000 }), ''],
  ])(
    'denies, discards the corrupt bucket, and lets the next request re-establish it (%s)',
    async (_label, rawState) => {
      if (!client) {
        return;
      }
      await seed(bucketKey, rawState);
      const limiter = await makeLimiter();

      const denied = await limiter.tryConsumeAtomic(NAMESPACE, 'tenant-c', 'registry-1');
      expect(denied).toEqual({ allowed: false, remaining: -1 });

      const stateAfter = await client.get(bucketKey);
      expect(stateAfter).toBeNull();

      const reEstablished = await limiter.tryConsumeAtomic(NAMESPACE, 'tenant-c', 'registry-1');
      expect(reEstablished.allowed).toBe(true);
      expect(reEstablished.remaining).toBe(MAX_TOKENS - 1);
    },
  );

  it('happy path keeps TTL, fractional accumulation, and time-based refill intact', async () => {
    if (!client) {
      return;
    }
    const fracNamespace = 'ext-gw-frac';
    const fracKey = `alga-psa:ratelimit:bucket:${fracNamespace}:tenant-d:registry-1`;
    await client.del(fracKey);
    await client.set(fracKey, JSON.stringify({ tokens: 1.5, lastRefillMs: now() }));

    TokenBucketRateLimiter.resetInstance();
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => client as unknown as TokenBucketRedisClient, {
      [fracNamespace]: async () => ({ maxTokens: 10, refillRate: 1 }),
    });

    const first = await limiter.tryConsumeAtomic(fracNamespace, 'tenant-d', 'registry-1');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0); // 1.5 - 1 = 0.5, floored

    const stored = JSON.parse((await client.get(fracKey))!);
    expect(stored.tokens).toBeCloseTo(0.5, 5);
    expect(stored.lastRefillMs).toBeGreaterThan(0);

    const ttlMs = await client.pTTL(fracKey);
    expect(ttlMs).toBeGreaterThan(3500 * 1000);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const second = await limiter.tryConsumeAtomic(fracNamespace, 'tenant-d', 'registry-1');
    expect(second.allowed).toBe(true); // ~1.6 after refill, still has budget
    expect(second.remaining).toBeGreaterThanOrEqual(0);
    expect(second.remaining).toBeLessThan(1);
  });

  it('concurrent fire against a bucket whose state is already corrupted never over-grants', async () => {
    if (!client) {
      return;
    }
    await seed(bucketKey, `{"tokens": ${MAX_TOKENS + 5}, "lastRefillMs": ${now()}}`);
    const limiter = await makeLimiter();

    const requests = MAX_TOKENS * 3;
    const results: RateLimitResult[] = await Promise.all(
      Array.from({ length: requests }, () => limiter.tryConsumeAtomic(NAMESPACE, 'tenant-c', 'registry-1')),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const abnormalDenials = results.filter((r) => r.remaining === -1).length;

    // Corrupt state is denied on the first EVAL; the key is discarded, so
    // exactly one fresh full bucket (MAX_TOKENS) may be served afterwards.
    expect(allowed).toBeLessThanOrEqual(MAX_TOKENS);
    expect(allowed).toBeGreaterThan(0);
    expect(abnormalDenials).toBeGreaterThan(0);
  });
});
