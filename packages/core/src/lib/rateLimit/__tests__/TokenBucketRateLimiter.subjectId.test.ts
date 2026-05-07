import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TokenBucketRateLimiter,
  type TokenBucketRedisClient,
} from '../TokenBucketRateLimiter';

function createMockRedis(): TokenBucketRedisClient & { data: Map<string, string> } {
  const data = new Map<string, string>();

  return {
    data,
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
      return 'OK';
    },
  };
}

describe('TokenBucketRateLimiter subject-aware config', () => {
  beforeEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  it('passes subjectId to the namespace getter and keys the bucket by subject', async () => {
    const redis = createMockRedis();
    const configGetter = vi.fn(async (_tenantId: string, subjectId?: string) => ({
      maxTokens: subjectId === 'k1' ? 2 : 1,
      refillRate: 1,
    }));

    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, { api: configGetter });

    const result = await limiter.tryConsume('api', 't1', 'k1');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(configGetter).toHaveBeenCalledWith('t1', 'k1');
    expect(redis.data.has('alga-psa:ratelimit:bucket:api:t1:k1')).toBe(true);
  });
});
