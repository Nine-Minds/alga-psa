import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  TokenBucketRateLimiter,
  type TokenBucketRedisClient,
} from '@alga-psa/email';

const testState = vi.hoisted(() => ({
  validateApiKeyAnyTenantMock: vi.fn(),
  validateApiKeyForTenantMock: vi.fn(),
  findUserByIdForApiMock: vi.fn(),
  validateApiKeyMock: vi.fn(),
  findUserByIdMock: vi.fn(),
  runWithTenantMock: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  hasPermissionMock: vi.fn(async () => true),
  apiRateLimitConfigGetterMock: vi.fn(async () => ({ maxTokens: 120, refillRate: 1 })),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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

vi.mock('@alga-psa/auth', () => ({
  ApiKeyService: {
    validateApiKey: (...args: unknown[]) => testState.validateApiKeyMock(...args),
  },
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  findUserById: (...args: unknown[]) => testState.findUserByIdMock(...args),
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

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: (...args: unknown[]) => testState.loggerWarnMock(...args),
    info: (...args: unknown[]) => testState.loggerInfoMock(...args),
    debug: (...args: unknown[]) => testState.loggerDebugMock(...args),
    error: (...args: unknown[]) => testState.loggerErrorMock(...args),
  },
}));

import { ApiBaseController } from '@/lib/api/controllers/ApiBaseController';
import {
  createSuccessResponse,
  withApiKeyAuth,
  withAuth,
} from '@/lib/api/middleware/apiMiddleware';

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

function createBrokenRedis(): TokenBucketRedisClient {
  return {
    async get() {
      throw new Error('redis unavailable');
    },
    async set() {
      throw new Error('redis unavailable');
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

function makeRequest(
  apiKey: string = 'test-api-key',
  tenantId?: string,
  url: string = 'http://localhost/api/v1/tickets',
) {
  const headers = new Headers({
    'x-api-key': apiKey,
  });
  if (tenantId) {
    headers.set('x-tenant-id', tenantId);
  }

  return new NextRequest(url, {
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
    testState.validateApiKeyMock.mockReset();
    testState.findUserByIdMock.mockReset();
    testState.runWithTenantMock.mockReset();
    testState.hasPermissionMock.mockReset();
    testState.apiRateLimitConfigGetterMock.mockReset();
    testState.loggerWarnMock.mockReset();
    testState.loggerInfoMock.mockReset();
    testState.loggerDebugMock.mockReset();
    testState.loggerErrorMock.mockReset();

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
    testState.validateApiKeyMock.mockResolvedValue({
      tenant: '11111111-1111-1111-1111-111111111111',
      api_key_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      user_id: '22222222-2222-2222-2222-222222222222',
    });
    testState.findUserByIdMock.mockResolvedValue({
      user_id: '22222222-2222-2222-2222-222222222222',
      tenant: '11111111-1111-1111-1111-111111111111',
      user_type: 'internal',
    });
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

  it('T011: bypass routes do not consume API rate-limit tokens', async () => {
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
    expect((await handler(makeRequest())).status).toBe(429);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const bypassResponse = await handler(
        makeRequest('test-api-key', undefined, 'http://localhost/api/v1/meta/health'),
      );
      expect(bypassResponse.status).toBe(200);
    }

    expect((await handler(makeRequest())).status).toBe(429);
  });

  it('T012: observation mode returns 200 while still logging the throttle event', async () => {
    process.env.RATE_LIMIT_ENFORCE = 'false';
    const controller = new TestTicketController();
    const handler = controller.list();

    let finalResponse: Response | null = null;
    for (let attempt = 1; attempt <= 121; attempt += 1) {
      finalResponse = await handler(makeRequest());
    }

    expect(finalResponse).not.toBeNull();
    expect(finalResponse!.status).toBe(200);
    expect(finalResponse!.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(finalResponse!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(testState.loggerWarnMock).toHaveBeenCalledWith(
      '[api-rate-limit] request throttled',
      expect.objectContaining({
        tenant: '11111111-1111-1111-1111-111111111111',
        api_key_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        retry_after_ms: expect.any(Number),
      }),
    );
  });

  it('T013: fails open when Redis operations throw and emits redis-unavailable metrics', async () => {
    TokenBucketRateLimiter.resetInstance();
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createBrokenRedis(),
      { api: async () => ({ maxTokens: 120, refillRate: 1 }) },
    );

    const controller = new TestTicketController();
    const handler = controller.list();

    for (let attempt = 1; attempt <= 200; attempt += 1) {
      const response = await handler(makeRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('-1');
    }

    expect(testState.loggerWarnMock).toHaveBeenCalledWith(
      '[metric] api_rate_limit_redis_unavailable_total',
      expect.objectContaining({
        tenant: '11111111-1111-1111-1111-111111111111',
        api_key_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        pathname: '/api/v1/tickets',
      }),
    );
  });

  it('T014: shares one bucket across ApiBaseController, withApiKeyAuth, and withAuth', async () => {
    TokenBucketRateLimiter.resetInstance();
    testState.apiRateLimitConfigGetterMock.mockResolvedValue({ maxTokens: 5, refillRate: 1 });
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: async () => ({ maxTokens: 5, refillRate: 1 }) },
    );

    const controllerHandler = new TestTicketController().list();
    const apiKeyAuthHandler = withApiKeyAuth()(
      async (req) => createSuccessResponse({ surface: 'withApiKeyAuth' }, 200, undefined, req),
    );
    const authHandler = await withAuth(
      async (req) => createSuccessResponse({ surface: 'withAuth' }, 200, undefined, req),
    );

    expect((await controllerHandler(makeRequest())).status).toBe(200);
    expect((await controllerHandler(makeRequest())).status).toBe(200);
    expect((await apiKeyAuthHandler(makeRequest())).status).toBe(200);
    expect((await apiKeyAuthHandler(makeRequest())).status).toBe(200);
    expect((await authHandler(makeRequest())).status).toBe(200);

    expect((await controllerHandler(makeRequest())).status).toBe(429);
    expect((await apiKeyAuthHandler(makeRequest())).status).toBe(429);
    expect((await authHandler(makeRequest())).status).toBe(429);
  });
});
