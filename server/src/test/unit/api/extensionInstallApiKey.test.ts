import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ key: vi.fn(), product: vi.fn(), install: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: {
  validateApiKeyAnyTenant: mocks.key, validateApiKeyForTenant: mocks.key,
} }));
vi.mock('@/lib/api/middleware/apiMiddleware', async () => {
  class UnauthorizedError extends Error { statusCode = 401; }
  return {
    UnauthorizedError,
    buildAuthenticatedApiContext: async (record: any) => ({ tenant: record.tenant, user: { tenant: record.tenant } }),
    handleApiError: (error: any) => NextResponse.json({ error: error.message }, { status: error.statusCode || 500 }),
  };
});
vi.mock('@/lib/db', () => ({ runWithTenant: async (_tenant: string, fn: any) => fn() }));
vi.mock('@alga-psa/auth', () => ({ runWithApiKeyUser: async (_user: any, fn: any) => fn() }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => ({}) }));
vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: mocks.product,
  ProductAccessError: class extends Error { statusCode = 403; },
}));
vi.mock('@/lib/api/standaloneProductGuards', () => ({ assertSessionProductAccess: mocks.session }));
vi.mock('@enterprise/app/api/v1/extensions/install/route', async () => {
  const { withApiKeyAuth } = await import('@/lib/api/middleware/apiAuthMiddleware');
  return { POST: async (request: NextRequest) => (await withApiKeyAuth(mocks.install))(request) };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  mocks.key.mockResolvedValue({ tenant: 'tenant-a' });
  mocks.product.mockResolvedValue('psa');
  mocks.install.mockResolvedValue(NextResponse.json({ success: true }, { status: 202 }));
  mocks.session.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
});
afterEach(() => vi.unstubAllEnvs());

async function post(key?: string) {
  const { POST } = await import('@/app/api/v1/extensions/install/route');
  return POST(new NextRequest('http://localhost/api/v1/extensions/install', {
    method: 'POST', headers: key ? { 'x-api-key': key } : {},
  }));
}
it('allows a valid API key without a browser session through the real API product gate', async () => {
  expect((await post('valid')).status).toBe(202);
  expect(mocks.install).toHaveBeenCalledOnce();
  expect(mocks.product).toHaveBeenCalledWith('tenant-a');
});
it('rejects invalid API keys before installation', async () => {
  mocks.key.mockResolvedValue(null);
  expect((await post('invalid')).status).toBe(401);
  expect(mocks.install).not.toHaveBeenCalled();
});
it('rejects an authenticated AlgaDesk tenant before installation', async () => {
  mocks.product.mockResolvedValue('algadesk');
  expect((await post('valid')).status).toBe(403);
  expect(mocks.install).not.toHaveBeenCalled();
});
it('continues rejecting unauthenticated requests', async () => {
  expect((await post()).status).toBe(401);
  expect(mocks.install).not.toHaveBeenCalled();
});
it('returns CE unavailability only after API-key and product validation', async () => {
  vi.stubEnv('EDITION', 'ce');
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
  expect((await post('valid')).status).toBe(501);
  expect(mocks.product).toHaveBeenCalledWith('tenant-a');
  expect(mocks.install).not.toHaveBeenCalled();
});

it.each(['invalid-key', 'disallowed-product'])('denies community %s before reporting availability', async (reason) => {
  vi.stubEnv('EDITION', 'ce');
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
  if (reason === 'invalid-key') mocks.key.mockResolvedValue(null);
  else mocks.product.mockResolvedValue('algadesk');
  expect((await post('key')).status).toBe(reason === 'invalid-key' ? 401 : 403);
  expect(mocks.install).not.toHaveBeenCalled();
});
