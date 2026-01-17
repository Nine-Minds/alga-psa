import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const setCookieMock = vi.fn();
const resolveCnameMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const getPortalDomainByHostnameMock = vi.fn();
const normalizeHostnameMock = vi.fn((host: string) => host.toLowerCase());
const consumeOttMock = vi.fn();
const encodeSessionMock = vi.fn();
const buildSessionCookieMock = vi.fn();
const analyticsCaptureMock = vi.fn();

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((data, init) => {
      const response = {
        json: vi.fn().mockResolvedValue(data),
        status: init?.status || 200,
        cookies: {
          set: setCookieMock,
        },
      };
      return response;
    }),
  },
}));

vi.mock('node:dns', () => ({
  promises: {
    resolveCname: resolveCnameMock,
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('server/src/models/PortalDomainModel', () => ({
  getPortalDomainByHostname: getPortalDomainByHostnameMock,
  normalizeHostname: normalizeHostnameMock,
}));

vi.mock('server/src/lib/models/PortalDomainSessionToken', () => ({
  consumePortalDomainOtt: consumeOttMock,
}));

vi.mock('server/src/lib/auth/sessionCookies', () => ({
  encodePortalSessionToken: encodeSessionMock,
  buildSessionCookie: buildSessionCookieMock,
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: analyticsCaptureMock,
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const originalDnsCheckEnv = process.env.PORTAL_DOMAIN_DNS_CHECK;

const { POST } = await import('./route');

const defaultPortalDomain = {
  id: 'domain-1',
  tenant: 'tenant-123',
  domain: 'portal.example.com',
  canonicalHost: 'tenant.portal.host',
  status: 'active',
  verificationDetails: { expected_cname: 'canonical.cdn.net' },
};

describe('client portal domain session exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.PORTAL_DOMAIN_DNS_CHECK = 'true';
    resolveCnameMock.mockResolvedValue(['canonical.cdn.net']);
    getAdminConnectionMock.mockResolvedValue({});
    getPortalDomainByHostnameMock.mockResolvedValue(defaultPortalDomain);
    consumeOttMock.mockResolvedValue({
      metadata: {
        userSnapshot: {
          id: 'user-1',
          email: 'user@example.com',
          tenant: defaultPortalDomain.tenant,
          user_type: 'client',
        },
        returnPath: '/client-portal/dashboard',
      },
    });
    encodeSessionMock.mockResolvedValue('signed-session-token');
    buildSessionCookieMock.mockReturnValue({
      name: '__Secure-authjs.session-token',
      value: 'signed-session-token',
      maxAge: 3600,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      },
    });
  });

  afterEach(() => {
    if (originalDnsCheckEnv === undefined) {
      delete process.env.PORTAL_DOMAIN_DNS_CHECK;
    } else {
      process.env.PORTAL_DOMAIN_DNS_CHECK = originalDnsCheckEnv;
    }
  });

  function buildRequest(
    body: Record<string, unknown>,
    host = 'portal.example.com',
    protocol: 'https' | 'http' = 'https',
  ) {
    return new Request(`${protocol}://portal.example.com/api/client-portal/domain-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host,
      },
      body: JSON.stringify(body),
    });
  }

  it('sets authjs session cookie and returns redirect path', async () => {
    const request = buildRequest({
      ott: 'ott-token-123',
      returnPath: '/client-portal/dashboard',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      redirectTo: '/client-portal/dashboard',
      canonicalHost: defaultPortalDomain.canonicalHost,
    });

    expect(encodeSessionMock).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'user@example.com',
      tenant: defaultPortalDomain.tenant,
      user_type: 'client',
    });

    expect(buildSessionCookieMock).toHaveBeenCalledWith('signed-session-token');

    expect(setCookieMock).toHaveBeenCalledWith({
      name: '__Secure-authjs.session-token',
      value: 'signed-session-token',
      maxAge: 3600,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
  });

  it('disables secure flag when request is not https', async () => {
    const request = buildRequest({
      ott: 'ott-token-123',
      returnPath: '/client-portal/dashboard',
    }, 'portal.example.com', 'http');

    await POST(request);

    const setCookieCall = setCookieMock.mock.calls.at(-1)?.[0];
    expect(setCookieCall).toMatchObject({ secure: false });
  });

  it('falls back to default dashboard when return path is unsafe', async () => {
    const request = buildRequest({
      ott: 'ott-token-123',
      returnPath: 'https://malicious.invalid',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(payload.redirectTo).toBe('/client-portal/dashboard');
  });

  it('returns error when OTT is invalid', async () => {
    consumeOttMock.mockResolvedValue(null);

    const response = await POST(buildRequest({ ott: 'expired-token' }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe('invalid_or_expired');
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('skips dns verification when disabled', async () => {
    process.env.PORTAL_DOMAIN_DNS_CHECK = 'false';
    resolveCnameMock.mockRejectedValue(new Error('should not be called'));

    const request = buildRequest({
      ott: 'ott-token-123',
      returnPath: '/client-portal/tickets',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(consumeOttMock).toHaveBeenCalled();
    expect(resolveCnameMock).not.toHaveBeenCalled();
  });
});
