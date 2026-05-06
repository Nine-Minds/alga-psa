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

function makeRequest(apiKey: string = 'test-api-key', tenantId?: string) {
  const headers = new Headers({
    'x-api-key': apiKey,
  });
  if (tenantId) {
    headers.set('x-tenant-id', tenantId);
  }

  return new NextRequest('http://localhost/api/v1/tickets', {
    headers,
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
    testState.runWithTenantMock.mockReset();
    testState.hasPermissionMock.mockReset();
    testState.apiRateLimitConfigGetterMock.mockReset();

    testState.validateApiKeyAnyTenantMock.mockImplementation(async (apiKey: string) => {
      if (apiKey === 'second-api-key') {
        return {
          tenant: '11111111-1111-1111-1111-111111111111',
          api_key_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          user_id: '22222222-2222-2222-2222-222222222222',
        };
      }

      return {
        tenant: '11111111-1111-1111-1111-111111111111',
        api_key_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: '22222222-2222-2222-2222-222222222222',
      };
    });
    testState.validateApiKeyForTenantMock.mockImplementation(async (_apiKey: string, tenantId: string) => {
      if (tenantId === '11111111-1111-1111-1111-111111111111') {
        return {
          tenant: tenantId,
          api_key_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          user_id: '22222222-2222-2222-2222-222222222222',
        };
      }

      if (tenantId === '33333333-3333-3333-3333-333333333333') {
        return {
          tenant: tenantId,
          api_key_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          user_id: '44444444-4444-4444-4444-444444444444',
        };
      }

      return null;
    });
    testState.findUserByIdForApiMock.mockImplementation(async (userId: string, tenantId: string) => ({
      user_id: userId,
      tenant: tenantId,
      user_type: 'internal',
    }));
    testState.runWithTenantMock.mockImplementation(async (_tenant: string, callback: () => Promise<unknown>) => callback());
    testState.hasPermissionMock.mockResolvedValue(true);
    testState.apiRateLimitConfigGetterMock.mockResolvedValue({ maxTokens: 120, refillRate: 1 });

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

  it('T008: emits success X-RateLimit headers on allowed requests', async () => {
    const controller = new TestTicketController();
    const response = await controller.list()(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('T009: isolates rate-limit buckets per API key within the same tenant', async () => {
    TokenBucketRateLimiter.resetInstance();
    testState.apiRateLimitConfigGetterMock.mockResolvedValue({ maxTokens: 5, refillRate: 1 });
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: async () => ({ maxTokens: 5, refillRate: 1 }) },
    );

    const controller = new TestTicketController();
    const handler = controller.list();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await handler(makeRequest())).status).toBe(200);
    }

    const throttled = await handler(makeRequest());
    expect(throttled.status).toBe(429);

    const secondKeyRequest = new NextRequest('http://localhost/api/v1/tickets', {
      headers: {
        'x-api-key': 'second-api-key',
      },
    });
    const unaffected = await handler(secondKeyRequest);

    expect(unaffected.status).toBe(200);
    expect(unaffected.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(unaffected.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('T010: isolates buckets across tenants even when the api_key_id value matches', async () => {
    TokenBucketRateLimiter.resetInstance();
    testState.apiRateLimitConfigGetterMock.mockResolvedValue({ maxTokens: 5, refillRate: 1 });
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: async () => ({ maxTokens: 5, refillRate: 1 }) },
    );

    const controller = new TestTicketController();
    const handler = controller.list();
    const tenantA = '11111111-1111-1111-1111-111111111111';
    const tenantB = '33333333-3333-3333-3333-333333333333';

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await handler(makeRequest('shared-api-key', tenantA))).status).toBe(200);
    }

    expect((await handler(makeRequest('shared-api-key', tenantA))).status).toBe(429);

    const unaffected = await handler(makeRequest('shared-api-key', tenantB));
    expect(unaffected.status).toBe(200);
    expect(unaffected.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(unaffected.headers.get('X-RateLimit-Remaining')).toBe('4');
  });
});
