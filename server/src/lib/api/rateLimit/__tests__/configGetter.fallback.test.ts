import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_UUID = '11111111-1111-1111-1111-111111111111';

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
    await expect(resolveApiRateLimitConfig('t1', KEY_UUID)).resolves.toEqual({
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
    await expect(resolveApiRateLimitConfig('t1', KEY_UUID)).resolves.toEqual({
      maxTokens: 240,
      refillRate: 2,
    });

    getForKeySpy.mockReset();
    getForKeySpy.mockResolvedValueOnce({
      tenant: 't1',
      apiKeyId: KEY_UUID,
      maxTokens: 30,
      refillPerMin: 15,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(resolveApiRateLimitConfig('t1', KEY_UUID)).resolves.toEqual({
      maxTokens: 30,
      refillRate: 0.25,
    });
  });

  it('skips the per-key lookup when the key is not a uuid', async () => {
    const module = await import('@/lib/api/rateLimit/apiRateLimitSettingsModel');
    const { resolveApiRateLimitConfig } = module;
    readOps = module.apiRateLimitSettingsReadOps;
    const getForKeySpy = vi.spyOn(readOps, 'getForKey');

    getForKeySpy.mockResolvedValueOnce({
      tenant: 't1',
      apiKeyId: null,
      maxTokens: 240,
      refillPerMin: 120,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 'nm_store' is the NM store bucket sentinel, not a uuid; querying the
    // uuid api_key_id column with it would raise a Postgres cast error.
    await expect(resolveApiRateLimitConfig('t1', 'nm_store')).resolves.toEqual({
      maxTokens: 240,
      refillRate: 2,
    });

    expect(getForKeySpy).toHaveBeenCalledTimes(1);
    expect(getForKeySpy).toHaveBeenCalledWith('t1', null);
    expect(getForKeySpy).not.toHaveBeenCalledWith('t1', 'nm_store');
  });
});
