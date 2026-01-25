import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TokenBucketRateLimiter,
  type TokenBucketRedisClient,
  type BucketConfig
} from '../../../../../packages/email/src/TokenBucketRateLimiter';

/**
 * Unit tests for the TokenBucketRateLimiter service.
 *
 * Token bucket rate limiting:
 * - Each bucket has maxTokens capacity (burst limit)
 * - Tokens refill at refillRate tokens per second
 * - Each request consumes 1 token
 * - Requests are rejected if no tokens available
 */

// Mock Redis client
function createMockRedis(): TokenBucketRedisClient & {
  _data: Map<string, string>;
} {
  const data = new Map<string, string>();

  return {
    _data: data,

    async get(key: string) {
      return data.get(key) ?? null;
    },

    async set(key: string, value: string, _options?: { EX?: number }) {
      data.set(key, value);
      return 'OK';
    }
  };
}

describe('TokenBucketRateLimiter', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    TokenBucketRateLimiter.resetInstance();
    mockRedis = createMockRedis();
  });

  afterEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  describe('Initialization', () => {
    it('should initialize with Redis client', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      expect(limiter.isReady()).toBe(false);

      await limiter.initialize(async () => mockRedis);
      expect(limiter.isReady()).toBe(true);
    });

    it('should warn if initialized twice', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(async () => mockRedis);

      // Second initialization should not throw
      await limiter.initialize(async () => mockRedis);
      expect(limiter.isReady()).toBe(true);
    });

    it('should return same instance for multiple getInstance calls', () => {
      const limiter1 = TokenBucketRateLimiter.getInstance();
      const limiter2 = TokenBucketRateLimiter.getInstance();
      expect(limiter1).toBe(limiter2);
    });
  });

  describe('Token Consumption', () => {
    it('should allow request when bucket has tokens', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(async () => mockRedis);

      const result = await limiter.tryConsume('tenant-1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59); // Started with 60, consumed 1
    });

    it('should allow multiple requests until bucket is empty', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      // Use a small bucket for testing
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 3, refillRate: 1 })
      );

      // First 3 requests should succeed
      expect((await limiter.tryConsume('tenant-1')).allowed).toBe(true);
      expect((await limiter.tryConsume('tenant-1')).allowed).toBe(true);
      expect((await limiter.tryConsume('tenant-1')).allowed).toBe(true);

      // 4th request should fail
      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should track tokens separately per tenant', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 2, refillRate: 1 })
      );

      // Exhaust tenant-1's bucket
      await limiter.tryConsume('tenant-1');
      await limiter.tryConsume('tenant-1');

      // tenant-1 should be rate limited
      expect((await limiter.tryConsume('tenant-1')).allowed).toBe(false);

      // tenant-2 should still have tokens
      expect((await limiter.tryConsume('tenant-2')).allowed).toBe(true);
    });

    it('should track tokens separately per user within a tenant', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 2, refillRate: 1 })
      );

      // Exhaust user-1's bucket in tenant-1
      await limiter.tryConsume('tenant-1', 'user-1');
      await limiter.tryConsume('tenant-1', 'user-1');

      // user-1 should be rate limited
      expect((await limiter.tryConsume('tenant-1', 'user-1')).allowed).toBe(false);

      // user-2 in same tenant should still have tokens
      expect((await limiter.tryConsume('tenant-1', 'user-2')).allowed).toBe(true);
    });
  });

  describe('Token Refill', () => {
    it('should refill tokens over time', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 2, refillRate: 10 }) // 10 tokens per second for fast test
      );

      // Exhaust bucket
      await limiter.tryConsume('tenant-1');
      await limiter.tryConsume('tenant-1');
      expect((await limiter.tryConsume('tenant-1')).allowed).toBe(false);

      // Simulate time passing (100ms = 1 token at 10/sec rate)
      // We need to manipulate the stored state to simulate time passing
      const bucketKey = 'alga-psa:ratelimit:bucket:tenant-1';
      const stateJson = mockRedis._data.get(bucketKey);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        state.lastRefillMs = Date.now() - 200; // 200ms ago = 2 tokens refilled
        mockRedis._data.set(bucketKey, JSON.stringify(state));
      }

      // Now should have tokens again
      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(true);
    });

    it('should not exceed maxTokens when refilling', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 5, refillRate: 100 }) // Very fast refill
      );

      // Consume one token
      await limiter.tryConsume('tenant-1');

      // Simulate a long time passing
      const bucketKey = 'alga-psa:ratelimit:bucket:tenant-1';
      const stateJson = mockRedis._data.get(bucketKey);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        state.lastRefillMs = Date.now() - 60000; // 1 minute ago
        mockRedis._data.set(bucketKey, JSON.stringify(state));
      }

      // Should be capped at maxTokens (5)
      const stateResult = await limiter.getState('tenant-1');
      expect(stateResult?.tokens).toBe(5);
      expect(stateResult?.maxTokens).toBe(5);
    });
  });

  describe('Retry After Calculation', () => {
    it('should return correct retryAfterMs when rate limited', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 1, refillRate: 1 }) // 1 token per second
      );

      // Exhaust bucket
      await limiter.tryConsume('tenant-1');

      // Next request should return ~1000ms retry time
      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThanOrEqual(900);
      expect(result.retryAfterMs).toBeLessThanOrEqual(1100);
    });

    it('should include reason when rate limited', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 1, refillRate: 1 })
      );

      await limiter.tryConsume('tenant-1');
      const result = await limiter.tryConsume('tenant-1');

      expect(result.reason).toContain('Rate limit exceeded');
      expect(result.reason).toContain('0 tokens remaining');
    });
  });

  describe('Fail Open Behavior', () => {
    it('should allow request when not initialized', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      // Not initialized

      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1); // Indicates unknown state
    });
  });

  describe('Get State', () => {
    it('should return current bucket state', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 10, refillRate: 1 })
      );

      // Consume some tokens
      await limiter.tryConsume('tenant-1');
      await limiter.tryConsume('tenant-1');

      const state = await limiter.getState('tenant-1');
      expect(state?.tokens).toBe(8);
      expect(state?.maxTokens).toBe(10);
    });

    it('should return full bucket for new tenant', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 50, refillRate: 1 })
      );

      const state = await limiter.getState('new-tenant');
      expect(state?.tokens).toBe(50);
      expect(state?.maxTokens).toBe(50);
    });
  });

  describe('Shutdown', () => {
    it('should cleanup on shutdown', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      await limiter.initialize(async () => mockRedis);
      expect(limiter.isReady()).toBe(true);

      await limiter.shutdown();
      expect(limiter.isReady()).toBe(false);
    });
  });
});

describe('Token Bucket vs Sliding Window Comparison', () => {
  describe('Burst Handling', () => {
    it('should allow burst up to maxTokens', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      const mockRedis = createMockRedis();

      // Configure for 60 tokens max (same as 60/minute rate limit)
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 60, refillRate: 1 })
      );

      // Should allow 60 rapid requests (burst)
      for (let i = 0; i < 60; i++) {
        const result = await limiter.tryConsume('tenant-1');
        expect(result.allowed).toBe(true);
      }

      // 61st should fail
      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(false);

      TokenBucketRateLimiter.resetInstance();
    });
  });

  describe('Sustained Rate', () => {
    it('should allow sustained rate equal to refill rate', async () => {
      const limiter = TokenBucketRateLimiter.getInstance();
      const mockRedis = createMockRedis();

      // 1 token per second = 60 per minute sustained
      await limiter.initialize(
        async () => mockRedis,
        async () => ({ maxTokens: 60, refillRate: 1 })
      );

      // Exhaust initial burst
      for (let i = 0; i < 60; i++) {
        await limiter.tryConsume('tenant-1');
      }

      // Simulate 1 second passing
      const bucketKey = 'alga-psa:ratelimit:bucket:tenant-1';
      const stateJson = mockRedis._data.get(bucketKey);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        state.lastRefillMs = Date.now() - 1000;
        mockRedis._data.set(bucketKey, JSON.stringify(state));
      }

      // Should allow 1 more request (1 token refilled)
      const result = await limiter.tryConsume('tenant-1');
      expect(result.allowed).toBe(true);

      TokenBucketRateLimiter.resetInstance();
    });
  });
});
