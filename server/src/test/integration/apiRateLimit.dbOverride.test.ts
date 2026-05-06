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
  validateApiKeyMock: vi.fn(),
  findUserByIdMock: vi.fn(),
  getAppSecretMock: vi.fn(),
  runWithTenantMock: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  hasPermissionMock: vi.fn(async () => true),
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

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: (...args: unknown[]) => testState.loggerWarnMock(...args),
    info: (...args: unknown[]) => testState.loggerInfoMock(...args),
    debug: (...args: unknown[]) => testState.loggerDebugMock(...args),
    error: (...args: unknown[]) => testState.loggerErrorMock(...args),
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: (...args: unknown[]) => testState.getAppSecretMock(...args),
  }),
}));

import { ApiBaseController } from '@/lib/api/controllers/ApiBaseController';
import { apiRateLimitConfigGetter } from '@/lib/api/rateLimit/apiRateLimitConfigGetter';
import { resetApiRateLimitConfigCacheForTests } from '@/lib/api/rateLimit/apiRateLimitConfigGetter';
import { apiRateLimitSettingsReadOps } from '@/lib/api/rateLimit/apiRateLimitSettingsModel';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const KEY_ONE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_TWO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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

function makeRequest(
  apiKey: string,
  url: string = 'http://localhost/api/v1/tickets',
) {
  const headers = new Headers({
    'x-api-key': apiKey,
  });
  return new NextRequest(url, { headers });
}

describe('API rate limit DB overrides (T016)', () => {
  const originalRateLimitEnforce = process.env.RATE_LIMIT_ENFORCE;

  beforeEach(async () => {
    process.env.RATE_LIMIT_ENFORCE = 'true';
    resetApiRateLimitConfigCacheForTests();
    TokenBucketRateLimiter.resetInstance();
    testState.validateApiKeyAnyTenantMock.mockReset();
    testState.validateApiKeyForTenantMock.mockReset();
    testState.findUserByIdForApiMock.mockReset();
    testState.validateApiKeyMock.mockReset();
    testState.findUserByIdMock.mockReset();
    testState.getAppSecretMock.mockReset();
    testState.runWithTenantMock.mockReset();
    testState.hasPermissionMock.mockReset();
    testState.loggerWarnMock.mockReset();
    testState.loggerInfoMock.mockReset();
    testState.loggerDebugMock.mockReset();
    testState.loggerErrorMock.mockReset();

    testState.validateApiKeyAnyTenantMock.mockImplementation(async (apiKey: string) => {
      if (apiKey === 'second-api-key') {
        return { tenant: TENANT_A, api_key_id: KEY_TWO, user_id: '22222222-2222-2222-2222-222222222222' };
      }
      return { tenant: TENANT_A, api_key_id: KEY_ONE, user_id: '22222222-2222-2222-2222-222222222222' };
    });
    testState.findUserByIdForApiMock.mockImplementation(async (userId: string, tenantId: string) => ({
      user_id: userId,
      tenant: tenantId,
      user_type: 'internal',
    }));
    testState.runWithTenantMock.mockImplementation(async (_tenant: string, callback: () => Promise<unknown>) => callback());
    testState.hasPermissionMock.mockResolvedValue(true);

    // Simulate a single seeded api_rate_limit_settings row for (TENANT_A, KEY_ONE).
    // No tenant-default row, no row for KEY_TWO.
    vi.spyOn(apiRateLimitSettingsReadOps, 'getForKey').mockImplementation(
      async (tenant: string, apiKeyId?: string | null) => {
        if (tenant === TENANT_A && apiKeyId === KEY_ONE) {
          return {
            tenant,
            apiKeyId: KEY_ONE,
            maxTokens: 3,
            refillPerMin: 60,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      },
    );

    // Bucket initialize uses the REAL apiRateLimitConfigGetter so the override
    // resolves through the production fallback logic instead of a static stub.
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { api: apiRateLimitConfigGetter },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetApiRateLimitConfigCacheForTests();
    TokenBucketRateLimiter.resetInstance();
    if (originalRateLimitEnforce === undefined) {
      delete process.env.RATE_LIMIT_ENFORCE;
    } else {
      process.env.RATE_LIMIT_ENFORCE = originalRateLimitEnforce;
    }
  });

  it('throttles K1 at the seeded per-key limit while K2 falls back to the tenant default', async () => {
    const handler = new TestTicketController().list();

    // K1 has a per-key override of max_tokens=3 — first 3 calls succeed.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await handler(makeRequest('test-api-key'));
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe(String(3 - attempt));
    }

    // 4th call exhausts the K1 bucket and is throttled.
    const throttled = await handler(makeRequest('test-api-key'));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(throttled.headers.get('X-RateLimit-Remaining')).toBe('0');

    // K2 has no override and no tenant default → uses hard-coded defaults (120, 1).
    const k2Response = await handler(makeRequest('second-api-key'));
    expect(k2Response.status).toBe(200);
    expect(k2Response.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(k2Response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });
});
