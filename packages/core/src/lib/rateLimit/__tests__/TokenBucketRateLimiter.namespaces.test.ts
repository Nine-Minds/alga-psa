import { describe, expect, it, beforeEach } from 'vitest';
import {
  TokenBucketRateLimiter,
  type TokenBucketRedisClient,
} from '../TokenBucketRateLimiter';

function createMockRedis(): TokenBucketRedisClient {
  const data = new Map<string, string>();

  return {
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
      return 'OK';
    },
  };
}

describe('TokenBucketRateLimiter namespace isolation', () => {
  beforeEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  it('keeps buckets independent across namespaces for the same tenant and subject', async () => {
    const limiter = TokenBucketRateLimiter.getInstance();

    await limiter.initialize(async () => createMockRedis(), {
      email: async () => ({ maxTokens: 1, refillRate: 1 }),
      api: async () => ({ maxTokens: 1, refillRate: 1 }),
    });

    expect((await limiter.tryConsume('email', 't1')).allowed).toBe(true);
    expect((await limiter.tryConsume('email', 't1')).allowed).toBe(false);

    const apiResult = await limiter.tryConsume('api', 't1');
    expect(apiResult.allowed).toBe(true);
    expect(apiResult.remaining).toBe(0);
  });
});
