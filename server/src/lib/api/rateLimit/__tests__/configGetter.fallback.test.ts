import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveApiRateLimitConfig', () => {
  let readOps: typeof import('@/lib/api/rateLimit/apiRateLimitSettingsModel').apiRateLimitSettingsReadOps;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back from per-key to tenant default to hard defaults', async () => {
    const module = await import('@/lib/api/rateLimit/apiRateLimitSettingsModel');
    const { resolveApiRateLimitConfig } = module;
    readOps = module.apiRateLimitSettingsReadOps;
    const getForKeySpy = vi.spyOn(readOps, 'getForKey');

    getForKeySpy.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(resolveApiRateLimitConfig('t1', 'k1')).resolves.toEqual({
      maxTokens: 120,
      refillRate: 1,
    });

    getForKeySpy.mockReset();
    getForKeySpy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tenant: 't1',
        apiKeyId: null,
        maxTokens: 240,
        refillPerMin: 120,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    await expect(resolveApiRateLimitConfig('t1', 'k1')).resolves.toEqual({
      maxTokens: 240,
      refillRate: 2,
    });

    getForKeySpy.mockReset();
    getForKeySpy.mockResolvedValueOnce({
      tenant: 't1',
      apiKeyId: 'k1',
      maxTokens: 30,
      refillPerMin: 15,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(resolveApiRateLimitConfig('t1', 'k1')).resolves.toEqual({
      maxTokens: 30,
      refillRate: 0.25,
    });
  });
});
