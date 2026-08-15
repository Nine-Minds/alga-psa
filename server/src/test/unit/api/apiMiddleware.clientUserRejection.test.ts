import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUserByIdForApi: vi.fn(),
  validateApiKeyForTenant: vi.fn(),
  validateApiKeyAnyTenant: vi.fn(),
  validateApiKey: vi.fn(),
  getSecretProviderInstance: vi.fn(),
  runAsSystem: vi.fn(),
  runWithTenant: vi.fn(),
  enforceApiRateLimit: vi.fn(),
  getTenantProduct: vi.fn(),
  resolveProductApiBehavior: vi.fn(),
  hasPermission: vi.fn(),
  redactSensitiveFields: vi.fn(),
  runWithApiKeyUser: vi.fn(),
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: mocks.findUserByIdForApi,
}));

vi.mock('@alga-psa/auth', () => ({
  ApiKeyService: {
    validateApiKey: mocks.validateApiKey,
  },
  runWithApiKeyUser: mocks.runWithApiKeyUser,
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyForTenant: mocks.validateApiKeyForTenant,
    validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant,
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: mocks.getSecretProviderInstance,
}));

vi.mock('@alga-psa/db', () => ({
  runAsSystem: mocks.runAsSystem,
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: mocks.runWithTenant,
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: vi.fn(async () => (() => undefined)),
}));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: mocks.enforceApiRateLimit,
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: mocks.getTenantProduct,
  ProductAccessError: class ProductAccessError extends Error {
    statusCode = 403;
    code = 'PRODUCT_ACCESS_DENIED';
  },
}));

vi.mock('@/lib/productSurfaceRegistry', () => ({
  resolveProductApiBehavior: mocks.resolveProductApiBehavior,
}));

vi.mock('../../../auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('../../../lib/api/utils/redactSensitiveFields', () => ({
  redactSensitiveFields: mocks.redactSensitiveFields,
}));

import { ApiBaseController } from '../../../lib/api/controllers/ApiBaseController';
import { UnauthorizedError, buildAuthenticatedApiContext, withApiKeyAuth, withAuth } from '../../../lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '../../../lib/api/middleware/apiAuthMiddleware';

class TestController extends ApiBaseController {
  constructor() {
    super({} as any, { resource: 'widget', permissions: {} } as any);
  }

  public authenticatePublic(req: NextRequest) {
    return this.authenticate(req);
  }
}

const CLIENT_USER = {
  user_id: 'client-user-1',
  tenant: 'tenant-1',
  user_type: 'client',
  contact_id: 'contact-1',
  clientId: 'client-1',
  email: 'client@example.com',
};

const INTERNAL_USER = {
  user_id: 'internal-user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
  email: 'internal@example.com',
};

function apiRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/tickets', { headers });
}

function validKeyRecord() {
  return { api_key_id: 'key-1', user_id: 'user-1', tenant: 'tenant-1', api_key: 'hash' };
}

describe('user API context construction rejects client users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceApiRateLimit.mockResolvedValue(null);
    mocks.getTenantProduct.mockResolvedValue('psa');
    mocks.resolveProductApiBehavior.mockReturnValue('allowed');
    mocks.runWithTenant.mockImplementation(async (_tenant: string, cb: () => Promise<unknown>) => cb());
    mocks.runWithApiKeyUser.mockImplementation(async (_user: unknown, cb: () => Promise<unknown>) => cb());
    mocks.redactSensitiveFields.mockImplementation((v: unknown) => v);
    mocks.getSecretProviderInstance.mockResolvedValue({ getAppSecret: async () => undefined });
  });

  it('buildAuthenticatedApiContext rejects a client user even when the validator returns a valid key', async () => {
    mocks.findUserByIdForApi.mockResolvedValue(CLIENT_USER);

    await expect(
      buildAuthenticatedApiContext(validKeyRecord())
    ).rejects.toThrow(UnauthorizedError);

    await expect(
      buildAuthenticatedApiContext(validKeyRecord())
    ).rejects.toThrow('Invalid API key');
  });

  it('buildAuthenticatedApiContext admits an internal user', async () => {
    mocks.findUserByIdForApi.mockResolvedValue(INTERNAL_USER);

    const context = await buildAuthenticatedApiContext(validKeyRecord());

    expect(context.user.user_id).toBe('internal-user-1');
    expect(context.kind).toBe('user');
  });

  it('ApiBaseController.authenticate rejects a client user before permission/service execution', async () => {
    mocks.validateApiKeyForTenant.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(CLIENT_USER);
    const controller = new TestController();

    await expect(
      controller.authenticatePublic(apiRequest({ 'x-api-key': 'k', 'x-tenant-id': 'tenant-1' }))
    ).rejects.toThrow('Invalid API key');

    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled();
  });

  it('enhanced authenticateApiKeyRequest rejects a client user (with and without x-tenant-id)', async () => {
    mocks.validateApiKeyForTenant.mockResolvedValue(validKeyRecord());
    mocks.validateApiKeyAnyTenant.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(CLIENT_USER);

    await expect(
      authenticateApiKeyRequest(apiRequest({ 'x-api-key': 'k', 'x-tenant-id': 'tenant-1' }))
    ).rejects.toThrow('Invalid API key');

    await expect(
      authenticateApiKeyRequest(apiRequest({ 'x-api-key': 'k' }))
    ).rejects.toThrow('Invalid API key');
  });

  it('legacy withApiKeyAuth and withAuth wrappers reject a client user with 401', async () => {
    mocks.validateApiKey.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(CLIENT_USER);

    const legacyWithApiKeyAuth = withApiKeyAuth()(async () => new Response('ok', { status: 200 }));
    const legacyAuthResponse = await legacyWithApiKeyAuth(apiRequest({ 'x-api-key': 'k' }) as any);
    expect(legacyAuthResponse.status).toBe(401);

    const legacyWithAuthMiddleware = await withAuth(async () => new Response('ok', { status: 200 }));
    const legacyWithAuthResponse = await legacyWithAuthMiddleware(
      apiRequest({ 'x-api-key': 'k' }) as any
    );
    expect(legacyWithAuthResponse.status).toBe(401);
  });

  it('enhanced withApiKeyAuth rejects a client user with 401', async () => {
    mocks.validateApiKeyAnyTenant.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(CLIENT_USER);

    const { withApiKeyAuth: enhancedWithApiKeyAuth } = await import('../../../lib/api/middleware/apiAuthMiddleware');
    const middleware = await enhancedWithApiKeyAuth(async () => new Response('ok', { status: 200 }));
    const response = await middleware(apiRequest({ 'x-api-key': 'k' }));

    expect(response.status).toBe(401);
  });

  it('internal users succeed through the enhanced middleware', async () => {
    mocks.validateApiKeyAnyTenant.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(INTERNAL_USER);

    const { withApiKeyAuth: enhancedWithApiKeyAuth } = await import('../../../lib/api/middleware/apiAuthMiddleware');
    const middleware = await enhancedWithApiKeyAuth(async () => new Response('ok', { status: 200 }));
    const response = await middleware(apiRequest({ 'x-api-key': 'k' }));

    expect(response.status).toBe(200);
  });

  it('NM Store system-key branch still creates a system context and never enters the user path', async () => {
    mocks.getSecretProviderInstance.mockResolvedValue({ getAppSecret: async () => 'nm-store-key' });
    mocks.runAsSystem.mockImplementation(async (_name: string, cb: () => Promise<unknown>) => cb());

    const { withApiKeyAuth: legacyWithOptions } = await import('../../../lib/api/middleware/apiMiddleware');
    let seenContext: unknown;
    const middleware = legacyWithOptions({ allowNmStore: true })(
      async (req: any) => {
        seenContext = req.context;
        return new Response('ok', { status: 200 });
      }
    );

    const response = await middleware(
      apiRequest({ 'x-api-key': 'nm-store-key', 'x-tenant-id': 'tenant-1' }) as any
    );

    expect(response.status).toBe(200);
    expect(seenContext).toMatchObject({ kind: 'system', rateLimitSubjectId: 'nm_store' });
    // The ordinary-user validator must not have been consulted for the system key.
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
    expect(mocks.findUserByIdForApi).not.toHaveBeenCalled();
  });

  it('an ordinary user key cannot enter the NM Store system branch', async () => {
    mocks.getSecretProviderInstance.mockResolvedValue({ getAppSecret: async () => 'nm-store-key' });
    mocks.validateApiKey.mockResolvedValue(validKeyRecord());
    mocks.findUserByIdForApi.mockResolvedValue(INTERNAL_USER);

    const { withApiKeyAuth: legacyWithOptions } = await import('../../../lib/api/middleware/apiMiddleware');
    let seenContext: unknown;
    const middleware = legacyWithOptions({ allowNmStore: true })(
      async (req: any) => {
        seenContext = req.context;
        return new Response('ok', { status: 200 });
      }
    );

    const response = await middleware(
      apiRequest({ 'x-api-key': 'ordinary-user-key', 'x-tenant-id': 'tenant-1' }) as any
    );

    expect(response.status).toBe(200);
    expect(seenContext).toMatchObject({ kind: 'user' });
  });
});
