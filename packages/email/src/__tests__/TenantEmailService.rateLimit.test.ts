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

  it('allows an ordinary send when initialized Redis EVAL fails, while valid quota exhaustion blocks', async () => {
    const providerSend = vi.fn(async () => ({ success: true }));
    const redis: TokenBucketRedisClient = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => { throw new Error('redis connection details must not be logged'); }),
    };
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      email: async () => ({ maxTokens: 1, refillRate: 1 }),
    });

    const outageGate = await TenantEmailService.checkEmailRateLimit('tenant-eval-failure', 'user-eval-failure');
    if (outageGate.allowed) await providerSend();
    expect(outageGate).toEqual({ allowed: true });
    expect(providerSend).toHaveBeenCalledOnce();

    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValueOnce([0, 0, 1000]);
    const exhaustedGate = await TenantEmailService.checkEmailRateLimit('tenant-eval-failure', 'user-eval-failure');
    if (exhaustedGate.allowed) await providerSend();

    expect(exhaustedGate).toMatchObject({ allowed: false, retryAfterMs: 1000 });
    expect(providerSend).toHaveBeenCalledOnce();
  });

  it('keeps an uninitialized limiter fail-open at the shared email gate', async () => {
    const providerSend = vi.fn(async () => ({ success: true }));
    const gate = await TenantEmailService.checkEmailRateLimit('tenant-no-redis', 'user-no-redis');
    if (gate.allowed) await providerSend();
    expect(gate).toEqual({ allowed: true });
    expect(providerSend).toHaveBeenCalledOnce();
  });
});
