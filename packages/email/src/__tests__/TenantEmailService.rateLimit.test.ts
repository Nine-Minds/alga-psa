import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantEmailService } from '../TenantEmailService';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import type { TokenBucketRedisClient } from '@alga-psa/core/rateLimit';

describe('TenantEmailService.checkEmailRateLimit', () => {
  afterEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  it('consumes from the atomic email bucket for the tenant and user', async () => {
    const redis: TokenBucketRedisClient = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => [1, 4, 0]),
    };
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      email: async () => ({ maxTokens: 5, refillRate: 1 }),
    });
    const nonAtomicConsume = vi.spyOn(limiter, 'tryConsume');
    const atomicConsume = vi.spyOn(limiter, 'tryConsumeAtomic');

    const result = await TenantEmailService.checkEmailRateLimit('tenant-unit', 'user-unit');

    expect(result).toEqual({ allowed: true });
    expect(atomicConsume).toHaveBeenCalledOnce();
    expect(atomicConsume).toHaveBeenCalledWith('email', 'tenant-unit', 'user-unit');
    expect(nonAtomicConsume).not.toHaveBeenCalled();
  });
});
