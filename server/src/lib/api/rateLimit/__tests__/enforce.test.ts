import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryConsumeMock = vi.hoisted(() => vi.fn());
const apiRateLimitConfigGetterMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({
      tryConsume: tryConsumeMock,
    }),
  },
}));

vi.mock('@/lib/api/rateLimit/apiRateLimitConfigGetter', () => ({
  apiRateLimitConfigGetter: apiRateLimitConfigGetterMock,
}));

describe('enforceApiRateLimit', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_ENFORCE;
    tryConsumeMock.mockReset();
    apiRateLimitConfigGetterMock.mockReset();
    apiRateLimitConfigGetterMock.mockResolvedValue({ maxTokens: 120, refillRate: 1 });
  });

  it('bypasses health and mobile-auth routes', async () => {
    const { enforceApiRateLimit, shouldBypassRateLimit } = await import('@/lib/api/rateLimit/enforce');

    expect(shouldBypassRateLimit('/api/health')).toBe(true);
    expect(shouldBypassRateLimit('/api/v1/mobile/auth/exchange')).toBe(true);
    expect(shouldBypassRateLimit('/api/internal/ext-runner/install-config')).toBe(true);
    expect(shouldBypassRateLimit('/api/v1/tickets')).toBe(false);

    const decision = await enforceApiRateLimit('http://example.com/api/health', {
      tenant: 'tenant-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
    });

    expect(decision).toBeNull();
    expect(tryConsumeMock).not.toHaveBeenCalled();
  });

  it('returns a decision instead of throwing when RATE_LIMIT_ENFORCE is false', async () => {
    tryConsumeMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1500,
    });

    const { enforceApiRateLimit } = await import('@/lib/api/rateLimit/enforce');

    const decision = await enforceApiRateLimit('http://example.com/api/v1/tickets', {
      tenant: 'tenant-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
    });

    expect(decision).toMatchObject({
      limit: 120,
      remaining: 0,
    });
  });

  it('uses a non-uuid subject for the bucket identity but not for the config lookup', async () => {
    tryConsumeMock.mockResolvedValue({
      allowed: true,
      remaining: 100,
    });

    const { enforceApiRateLimit } = await import('@/lib/api/rateLimit/enforce');

    const decision = await enforceApiRateLimit('http://example.com/api/v1/tickets', {
      tenant: 'tenant-1',
      userId: '00000000-0000-0000-0000-000000000000',
      rateLimitSubjectId: 'nm_store',
    });

    // 'nm_store' must never reach the config getter (api_key_id is a uuid
    // column); it is only the token-bucket identity.
    expect(apiRateLimitConfigGetterMock).toHaveBeenCalledWith('tenant-1', undefined);
    expect(tryConsumeMock).toHaveBeenCalledWith('api', 'tenant-1', 'nm_store');
    expect(decision).toMatchObject({ limit: 120, remaining: 100 });
  });

  it('throws TooManyRequestsError with retry headers when RATE_LIMIT_ENFORCE is true', async () => {
    process.env.RATE_LIMIT_ENFORCE = 'true';
    tryConsumeMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1500,
    });

    const { enforceApiRateLimit } = await import('@/lib/api/rateLimit/enforce');
    const { TooManyRequestsError } = await import('@/lib/api/middleware/apiMiddleware');

    await expect(
      enforceApiRateLimit('http://example.com/api/v1/tickets', {
        tenant: 'tenant-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
      }),
    ).rejects.toMatchObject({
      name: TooManyRequestsError.name,
      details: {
        retry_after_ms: 1500,
        remaining: 0,
      },
      headers: {
        'Retry-After': '2',
        'X-RateLimit-Limit': '120',
        'X-RateLimit-Remaining': '0',
      },
    });
  });
});
