import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const consumeLimiterMock = vi.fn(async () => ({ remainingPoints: 11 }));
const resolveTenantContextMock = vi.fn();
const discoverProvidersMock = vi.fn();
const getSigningSecretMock = vi.fn(async () => 'unit-test-signing-secret');
const createCookieMock = vi.fn(() => ({ value: 'signed-client-portal-discovery-cookie' }));

vi.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: class {
    consume(key: string) {
      return consumeLimiterMock(key);
    }
  },
}));

vi.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: {
    json: vi.fn((data, init) => ({
      status: init?.status ?? 200,
      json: async () => data,
      cookies: { set: setCookieMock },
    })),
  },
}));

vi.mock('@alga-psa/auth/lib/sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS: 300,
  createSignedClientPortalSsoDiscoveryCookie: (...args: unknown[]) => createCookieMock(...args),
  discoverClientPortalSsoProviders: (...args: unknown[]) => discoverProvidersMock(...args),
  getMspSsoSigningSecret: () => getSigningSecretMock(),
  isValidClientPortalResolverCallbackUrl: (value: string | undefined) =>
    !value ||
    value.startsWith('/client-portal') ||
    value.startsWith('/auth/client-portal/handoff'),
  normalizeResolverEmail: (value: string) => value.trim().toLowerCase(),
  resolveClientPortalSsoTenantContext: (...args: unknown[]) => resolveTenantContextMock(...args),
}));

const { POST } = await import('./route');

function buildRequest(body: Record<string, unknown>) {
  return new Request('https://example.com/api/auth/client-portal/sso/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/client-portal/sso/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue({});
    discoverProvidersMock.mockResolvedValue(['google']);
    getSigningSecretMock.mockResolvedValue('unit-test-signing-secret');
    createCookieMock.mockReturnValue({ value: 'signed-client-portal-discovery-cookie' });
  });

  it('T001: returns neutral discovery response when tenant context cannot be resolved', async () => {
    const response = await POST(buildRequest({ email: 'user@example.com' }) as any);
    await expect(response.json()).resolves.toEqual({ ok: true, providers: [] });
  });

  it('rejects non-client-portal relative callback URLs before resolving tenant context', async () => {
    const response = await POST(
      buildRequest({
        email: 'user@example.com',
        tenantSlug: 'abc123def456',
        callbackUrl: '/msp/dashboard',
      }) as any
    );

    await expect(response.json()).resolves.toEqual({ ok: true, providers: [] });
    expect(resolveTenantContextMock).not.toHaveBeenCalled();
    expect(createCookieMock).not.toHaveBeenCalled();
  });

  it('T002: returns providers and sets signed discovery cookie when tenant context resolves from slug', async () => {
    resolveTenantContextMock.mockResolvedValueOnce({ tenantId: 'tenant-1' });
    discoverProvidersMock.mockResolvedValueOnce(['azure-ad']);

    const response = await POST(
      buildRequest({ email: 'user@example.com', tenantSlug: 'abc123def456' }) as any
    );
    await expect(response.json()).resolves.toEqual({ ok: true, providers: ['azure-ad'] });
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'client_portal_sso_discovery',
        value: 'signed-client-portal-discovery-cookie',
        maxAge: 300,
      })
    );
  });

  it('T003: returns providers when tenant context resolves from portal domain', async () => {
    resolveTenantContextMock.mockResolvedValueOnce({ tenantId: 'tenant-2' });
    discoverProvidersMock.mockResolvedValueOnce(['google', 'azure-ad']);

    const response = await POST(
      buildRequest({ email: 'user@example.com', portalDomain: 'portal.acme.test' }) as any
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: ['google', 'azure-ad'],
    });
  });
});
