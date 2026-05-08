import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveApiRateLimitConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/rateLimit/apiRateLimitSettingsModel', () => ({
  resolveApiRateLimitConfig: resolveApiRateLimitConfigMock,
}));

describe('invalidateApiRateLimitConfig', () => {
  beforeEach(async () => {
    const { resetApiRateLimitConfigCacheForTests } = await import('@/lib/api/rateLimit/apiRateLimitConfigGetter');
    resetApiRateLimitConfigCacheForTests();
    resolveApiRateLimitConfigMock.mockReset();
    resolveApiRateLimitConfigMock.mockImplementation(async (tenantId: string, apiKeyId?: string) => ({
      maxTokens: apiKeyId === 'k2' ? 90 : 120,
      refillRate: tenantId === 't2' ? 2 : 1,
    }));
  });

  it('clears every cached entry for a tenant when apiKeyId is omitted', async () => {
    const { apiRateLimitConfigGetter, invalidateApiRateLimitConfig } = await import('@/lib/api/rateLimit/apiRateLimitConfigGetter');

    await apiRateLimitConfigGetter('t1', 'k1');
    await apiRateLimitConfigGetter('t1', 'k2');
    await apiRateLimitConfigGetter('t2', 'k1');

    resolveApiRateLimitConfigMock.mockClear();
    invalidateApiRateLimitConfig('t1');

    await apiRateLimitConfigGetter('t1', 'k1');
    await apiRateLimitConfigGetter('t1', 'k2');
    await apiRateLimitConfigGetter('t2', 'k1');

    expect(resolveApiRateLimitConfigMock).toHaveBeenCalledTimes(2);
    expect(resolveApiRateLimitConfigMock).toHaveBeenNthCalledWith(1, 't1', 'k1');
    expect(resolveApiRateLimitConfigMock).toHaveBeenNthCalledWith(2, 't1', 'k2');
  });

  it('clears only one cached entry when tenant and apiKeyId are provided', async () => {
    const { apiRateLimitConfigGetter, invalidateApiRateLimitConfig } = await import('@/lib/api/rateLimit/apiRateLimitConfigGetter');

    await apiRateLimitConfigGetter('t1', 'k1');
    await apiRateLimitConfigGetter('t1', 'k2');

    resolveApiRateLimitConfigMock.mockClear();
    invalidateApiRateLimitConfig('t1', 'k1');

    await apiRateLimitConfigGetter('t1', 'k1');
    await apiRateLimitConfigGetter('t1', 'k2');

    expect(resolveApiRateLimitConfigMock).toHaveBeenCalledTimes(1);
    expect(resolveApiRateLimitConfigMock).toHaveBeenCalledWith('t1', 'k1');
  });
});
