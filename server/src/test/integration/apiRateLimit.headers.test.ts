import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  TokenBucketRateLimiter,
  type TokenBucketRedisClient,
} from '@alga-psa/email';

const testState = vi.hoisted(() => ({
  validateApiKeyAnyTenantMock: vi.fn(),
  validateApiKeyForTenantMock: vi.fn(),
  findUserByIdForApiMock: vi.fn(),
  runWithTenantMock: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  hasPermissionMock: vi.fn(async () => true),
  apiRateLimitConfigGetterMock: vi.fn(async () => ({ maxTokens: 120, refillRate: 1 })),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: (...args: unknown[]) => testState.validateApiKeyAnyTenantMock(...args),
    validateApiKeyForTenant: (...args: unknown[]) => testState.validateApiKeyForTenantMock(...args),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: (...args: unknown[]) => testState.findUserByIdForApiMock(...args),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: (...args: unknown[]) => testState.runWithTenantMock(...args),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => testState.hasPermissionMock(...args),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@/lib/api/rateLimit/apiRateLimitConfigGetter', () => ({
  apiRateLimitConfigGetter: (...args: unknown[]) => testState.apiRateLimitConfigGetterMock(...args),
}));

import { ApiBaseController } from '@/lib/api/controllers/ApiBaseController';

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

class TestTicketController extends ApiBaseController {
  constructor() {
    super(
      {
        list: vi.fn(async () => ({
          data: [{ ticket_id: 'ticket-1' }],
          total: 1,
        })),
      } as any,
      {
        resource: 'ticket',
      } as any,
    );
  }
}

function makeRequest() {
  return new NextRequest('http://localhost/api/v1/tickets', {
    headers: {
      'x-api-key': 'test-api-key',
    },
  });
}

describe('API rate limit headers', () => {
  const originalRateLimitEnforce = process.env.RATE_LIMIT_ENFORCE;

  beforeEach(async () => {
    process.env.RATE_LIMIT_ENFORCE = 'true';
    TokenBucketRateLimiter.resetInstance();
    testState.validateApiKeyAnyTenantMock.mockReset();
    testState.validateApiKeyForTenantMock.mockReset();
    testState.findUserByIdForApiMock.mockReset();
    testState.runWithTenantMock.mockClear();
    testState.hasPermissionMock.mockClear();
    testState.apiRateLimitConfigGetterMock.mockClear();

    testState.validateApiKeyAnyTenantMock.mockResolvedValue({
      tenant: '11111111-1111-1111-1111-111111111111',
      api_key_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      user_id: '22222222-2222-2222-2222-222222222222',
    });
    testState.validateApiKeyForTenantMock.mockResolvedValue(null);
    testState.findUserByIdForApiMock.mockResolvedValue({
      user_id: '22222222-2222-2222-2222-222222222222',
      tenant: '11111111-1111-1111-1111-111111111111',
      user_type: 'internal',
    });

    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: async () => ({ maxTokens: 120, refillRate: 1 }) },
    );
  });

  afterEach(() => {
    TokenBucketRateLimiter.resetInstance();
    if (originalRateLimitEnforce === undefined) {
      delete process.env.RATE_LIMIT_ENFORCE;
    } else {
      process.env.RATE_LIMIT_ENFORCE = originalRateLimitEnforce;
    }
  });

  it('T007: returns 429 with retry and X-RateLimit headers on the 121st authenticated request', async () => {
    const controller = new TestTicketController();
    const handler = controller.list();

    for (let attempt = 1; attempt <= 120; attempt += 1) {
      const response = await handler(makeRequest());
      expect(response.status).toBe(200);
    }

    const throttledResponse = await handler(makeRequest());
    const body = await throttledResponse.json();
    const retryAfter = throttledResponse.headers.get('Retry-After');
    const resetAt = throttledResponse.headers.get('X-RateLimit-Reset');

    expect(throttledResponse.status).toBe(429);
    expect(retryAfter).toMatch(/^\d+$/);
    expect(throttledResponse.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(throttledResponse.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(resetAt).toBeTruthy();
    expect(new Date(resetAt!).getTime()).toBeGreaterThan(Date.now());
    expect(body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        details: {
          retry_after_ms: expect.any(Number),
          remaining: 0,
        },
      },
    });
    expect(body.error.details.retry_after_ms).toBeGreaterThan(0);
  });
});
