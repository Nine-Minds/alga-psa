import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('TokenBucketRateLimiter email regression', () => {
  beforeEach(() => {
    TokenBucketRateLimiter.resetInstance();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the legacy email bucket behavior when using the email namespace', async () => {
    const limiter = TokenBucketRateLimiter.getInstance();

    await limiter.initialize(async () => createMockRedis(), {
      email: async () => ({ maxTokens: 60, refillRate: 1 }),
    });

    const checkpoints: Array<{
      call: number;
      allowed: boolean;
      remaining: number;
      retryAfterMs: number | null;
    }> = [];

    for (let call = 1; call <= 61; call += 1) {
      const result = await limiter.tryConsume('email', 'tenant-1');
      if ([1, 30, 60, 61].includes(call)) {
        checkpoints.push({
          call,
          allowed: result.allowed,
          remaining: result.remaining,
          retryAfterMs: result.retryAfterMs ?? null,
        });
      }
    }

    expect(checkpoints).toEqual([
      { call: 1, allowed: true, remaining: 59, retryAfterMs: null },
      { call: 30, allowed: true, remaining: 30, retryAfterMs: null },
      { call: 60, allowed: true, remaining: 0, retryAfterMs: null },
      { call: 61, allowed: false, remaining: 0, retryAfterMs: 1000 },
    ]);
  });
});
