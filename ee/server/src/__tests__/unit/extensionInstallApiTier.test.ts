import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as any,
  tiers: new Map<string, string>(),
  install: vi.fn(async () => ({ success: true, installId: 'installed-version' })),
}));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => state.session }));
vi.mock('@alga-psa/licensing', () => ({
  resolveTenantTier: async (tenant: string) => state.tiers.get(tenant) ?? 'essentials',
  hasActiveSoloProTrial: () => false,
}));
vi.mock('server/src/lib/features', () => ({ isEnterprise: true }));
vi.mock('@ee/lib/actions/extRegistryV2Actions', () => ({ installExtensionForCurrentTenantV2: state.install }));
// Native API coverage separately validates actual API keys, RBAC and installs.
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  withApiKeyAuth: async (handler: any) => async (req: any) => {
    req.context = { tenant: req.headers.get('x-test-api-tenant'), userId: 'api-user' };
    return handler(req);
  },
}));
vi.mock('@/lib/api/middleware/apiMiddleware', () => ({
  withPermission: () => (handler: any) => handler,
  withValidation: (schema: any) => (handler: any) => async (req: any) => handler(req, schema.parse(await req.json())),
  createSuccessResponse: (data: unknown, status: number) => NextResponse.json({ data }, { status }),
  handleApiError: (error: any) => NextResponse.json({ code: error.code, error: error.message }, { status: error.statusCode ?? 500 }),
}));
const { POST } = await import('../../app/api/v1/extensions/install/route');
const request = (tenant: string) => new NextRequest('http://localhost/api/v1/extensions/install', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-test-api-tenant': tenant },
  body: JSON.stringify({ registryId: 'registry', version: '1.0.0' }),
});
beforeEach(() => {
  state.session = null;
  state.tiers = new Map([['api-pro', 'pro'], ['api-essentials', 'essentials'], ['browser-pro', 'pro']]);
  state.install.mockClear();
});
it('installs for a Pro API tenant without a browser session', async () => {
  const response = await POST(request('api-pro'));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ data: { success: true, installId: 'installed-version' } });
});
it('does not borrow a browser tenant tier to authorize an Essentials API tenant', async () => {
  state.session = { user: { tenant: 'browser-pro', plan: 'pro' } };
  const response = await POST(request('api-essentials'));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'TIER_ACCESS_DENIED' });
  expect(state.install).not.toHaveBeenCalled();
});
it('denies an Essentials API tenant when no browser session exists', async () => {
  const response = await POST(request('api-essentials'));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'TIER_ACCESS_DENIED' });
  expect(state.install).not.toHaveBeenCalled();
});
it('does not let an unrelated lower-tier browser session deny a Pro API tenant', async () => {
  state.session = { user: { tenant: 'browser-essentials', plan: 'essentials' } };
  state.tiers.set('browser-essentials', 'essentials');
  const response = await POST(request('api-pro'));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ data: { success: true } });
});
