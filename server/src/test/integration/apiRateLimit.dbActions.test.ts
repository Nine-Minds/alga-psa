import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter, type TokenBucketRedisClient } from '@alga-psa/email';

import {
  apiRateLimitConfigGetter,
  invalidateApiRateLimitConfig,
  resetApiRateLimitConfigCacheForTests,
} from '@/lib/api/rateLimit/apiRateLimitConfigGetter';
import { apiRateLimitSettingsReadOps } from '@/lib/api/rateLimit/apiRateLimitSettingsModel';

const TENANT = '11111111-1111-1111-1111-111111111111';
const KEY_ONE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

/**
 * T017 — Verifies the contract the rate-limit server actions live on:
 *
 *   setApiRateLimitForKey  → upsertForKey + invalidateApiRateLimitConfig(tenant, apiKeyId)
 *   clearApiRateLimitForKey → clearForKey  + invalidateApiRateLimitConfig(tenant, apiKeyId)
 *
 * The 30s LRU cache otherwise hides DAL writes from `enforceApiRateLimit`. This
 * test simulates the action sequence (DAL state change → invalidate) against
 * the real cache + bucket so a stale cache entry would show up as a failure.
 *
 * The session-gated `withAuth` wrapper itself is intentionally not exercised —
 * RBAC/session machinery is covered by other tests; T017's interest is the
 * "subsequent enforce call sees new limit immediately, not after 30s" semantic.
 */
describe('API rate limit DB actions contract (T017)', () => {
  let getForKeySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetApiRateLimitConfigCacheForTests();
    TokenBucketRateLimiter.resetInstance();

    getForKeySpy = vi.spyOn(apiRateLimitSettingsReadOps, 'getForKey').mockResolvedValue(null);

    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: apiRateLimitConfigGetter },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetApiRateLimitConfigCacheForTests();
    TokenBucketRateLimiter.resetInstance();
  });

  it('setApiRateLimitForKey: write + invalidate makes the new limit visible to the next enforce call', async () => {
    // Baseline: no override row anywhere → hard defaults populate the cache.
    const baseline = await apiRateLimitConfigGetter(TENANT, KEY_ONE);
    expect(baseline).toEqual({ maxTokens: 120, refillRate: 1 });

    // Without invalidation, a fresh DAL value would stay hidden behind the 30s TTL.
    getForKeySpy.mockImplementation(async (tenant: string, apiKeyId?: string | null) => {
      if (tenant === TENANT && apiKeyId === KEY_ONE) {
        return {
          tenant,
          apiKeyId: KEY_ONE,
          maxTokens: 3,
          refillPerMin: 60,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    });

    const stillCached = await apiRateLimitConfigGetter(TENANT, KEY_ONE);
    expect(stillCached).toEqual({ maxTokens: 120, refillRate: 1 });

    // The action's tail call: invalidateApiRateLimitConfig(tenant, apiKeyId).
    invalidateApiRateLimitConfig(TENANT, KEY_ONE);

    const afterWrite = await apiRateLimitConfigGetter(TENANT, KEY_ONE);
    expect(afterWrite).toEqual({ maxTokens: 3, refillRate: 1 });

    // The bucket also resolves through the same getter, so an enforce call
    // would now throttle on the 4th request, not the 121st.
    const limiter = TokenBucketRateLimiter.getInstance();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await limiter.tryConsume('api', TENANT, KEY_ONE);
      expect(result.allowed).toBe(true);
    }
    const fourth = await limiter.tryConsume('api', TENANT, KEY_ONE);
    expect(fourth.allowed).toBe(false);
  });

  it('clearApiRateLimitForKey: removes the override row + invalidates so the tenant default is restored', async () => {
    // Start with an override row in place.
    getForKeySpy.mockImplementation(async (tenant: string, apiKeyId?: string | null) => {
      if (tenant === TENANT && apiKeyId === KEY_ONE) {
        return {
          tenant,
          apiKeyId: KEY_ONE,
          maxTokens: 3,
          refillPerMin: 60,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    });

    const beforeClear = await apiRateLimitConfigGetter(TENANT, KEY_ONE);
    expect(beforeClear).toEqual({ maxTokens: 3, refillRate: 1 });

    // Action equivalent: clearForKey deletes the row, then invalidate.
    getForKeySpy.mockResolvedValue(null);
    invalidateApiRateLimitConfig(TENANT, KEY_ONE);

    const afterClear = await apiRateLimitConfigGetter(TENANT, KEY_ONE);
    expect(afterClear).toEqual({ maxTokens: 120, refillRate: 1 });
  });
});
