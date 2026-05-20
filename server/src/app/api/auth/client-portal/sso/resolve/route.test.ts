import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const consumeLimiterMock = vi.fn(async () => ({ remainingPoints: 7 }));
const getSigningSecretMock = vi.fn(async () => 'unit-test-signing-secret');
const parseDiscoveryCookieMock = vi.fn();
const resolveTenantContextMock = vi.fn();
const createCookieMock = vi.fn(() => ({ value: 'signed-client-portal-resolution-cookie' }));

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
  CLIENT_PORTAL_SSO_GENERIC_FAILURE_MESSAGE:
    "We couldn't start SSO sign-in. Please verify provider setup and try again.",
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
  CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS: 300,
  createSignedClientPortalSsoResolutionCookie: (...args: unknown[]) => createCookieMock(...args),
  getMspSsoSigningSecret: () => getSigningSecretMock(),
  isValidClientPortalResolverCallbackUrl: (value: string | undefined) =>
    !value || value.startsWith('/client-portal') || value.includes('/auth/client-portal/handoff'),
  normalizeResolverEmail: (value: string) => value.trim().toLowerCase(),
  parseAndVerifyClientPortalSsoDiscoveryCookie: (...args: unknown[]) => parseDiscoveryCookieMock(...args),
  parseResolverProvider: (value: unknown) => (value === 'google' || value === 'azure-ad' ? value : null),
  resolveClientPortalSsoTenantContext: (...args: unknown[]) => resolveTenantContextMock(...args),
}));

vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  MSP_SSO_DISCOVERY_COOKIE: 'msp_sso_discovery',
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
}));

const { POST } = await import('./route');

type RequestOptions = { discoveryCookie?: string };
function buildRequest(body: Record<string, unknown>, options?: RequestOptions) {
  const request = new Request('https://example.com/api/auth/client-portal/sso/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  }) as Request & { cookies: { get: (name: string) => { value: string } | undefined } };
  request.cookies = {
    get: (name: string) => {
      if (name === 'client_portal_sso_discovery' && options?.discoveryCookie) {
        return { value: options.discoveryCookie };
      }
      return undefined;
    },
  };
  return request;
}

describe('POST /api/auth/client-portal/sso/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSigningSecretMock.mockResolvedValue('unit-test-signing-secret');
    parseDiscoveryCookieMock.mockReturnValue({
      audience: 'client_portal',
      tenantId: 'tenant-1',
      providers: ['azure-ad'],
      callbackUrl: '/client-portal/dashboard',
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      nonce: 'nonce',
    });
    resolveTenantContextMock.mockResolvedValue({ tenantId: 'tenant-1' });
    createCookieMock.mockReturnValue({ value: 'signed-client-portal-resolution-cookie' });
  });

  it('T004: rejects provider mismatch from discovery allow-list with generic failure', async () => {
    const response = await POST(
      buildRequest(
        { provider: 'google', email: 'user@example.com', callbackUrl: '/client-portal/dashboard' },
        { discoveryCookie: 'signed-discovery-cookie' }
      ) as any
    );
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    });
  });

  it('T004: accepts matching provider/tenant context and sets signed resolution cookie', async () => {
    const response = await POST(
      buildRequest(
        { provider: 'azure-ad', email: 'user@example.com', callbackUrl: '/client-portal/dashboard' },
        { discoveryCookie: 'signed-discovery-cookie' }
      ) as any
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'client_portal_sso_resolution',
        value: 'signed-client-portal-resolution-cookie',
        maxAge: 300,
      })
    );
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_sso_resolution',
        value: '',
        maxAge: 0,
      })
    );
  });
});
