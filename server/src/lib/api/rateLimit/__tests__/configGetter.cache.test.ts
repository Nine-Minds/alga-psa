import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveApiRateLimitConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/rateLimit/apiRateLimitSettingsModel', () => ({
  resolveApiRateLimitConfig: resolveApiRateLimitConfigMock,
}));

describe('apiRateLimitConfigGetter cache', () => {
  beforeEach(async () => {
    const { resetApiRateLimitConfigCacheForTests } = await import('@/lib/api/rateLimit/apiRateLimitConfigGetter');
    resetApiRateLimitConfigCacheForTests();
    resolveApiRateLimitConfigMock.mockReset();
  });

  it('hits the DAL only once for consecutive identical lookups', async () => {
    resolveApiRateLimitConfigMock.mockResolvedValue({ maxTokens: 120, refillRate: 1 });

    const { apiRateLimitConfigGetter } = await import('@/lib/api/rateLimit/apiRateLimitConfigGetter');

    await apiRateLimitConfigGetter('t1', 'k1');
    await apiRateLimitConfigGetter('t1', 'k1');

    expect(resolveApiRateLimitConfigMock).toHaveBeenCalledTimes(1);
    expect(resolveApiRateLimitConfigMock).toHaveBeenCalledWith('t1', 'k1');
  });
});
