import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const setCookieMock = vi.fn();
const resolveCnameMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const getPortalDomainByHostnameMock = vi.fn();
const normalizeHostnameMock = vi.fn((host: string) => host.toLowerCase());
const consumeOttMock = vi.fn();
const encodeSessionMock = vi.fn();
const buildSessionCookieMock = vi.fn();
const getClientIpMock = vi.fn();
const generateDeviceFingerprintMock = vi.fn();
const getDeviceInfoMock = vi.fn();
const getLocationFromIpMock = vi.fn();
const getSessionMaxAgeMock = vi.fn();
const enforceMaxSessionsMock = vi.fn();
const createSessionMock = vi.fn();
const updateLocationMock = vi.fn();
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

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    enforceMaxSessions: enforceMaxSessionsMock,
    create: createSessionMock,
    updateLocation: updateLocationMock,
  },
}));

vi.mock('server/src/models/PortalDomainModel', () => ({
  getPortalDomainByHostname: getPortalDomainByHostnameMock,
  normalizeHostname: normalizeHostnameMock,
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  consumePortalDomainOtt: consumeOttMock,
  encodePortalSessionToken: encodeSessionMock,
  buildSessionCookie: buildSessionCookieMock,
  getClientIp: getClientIpMock,
  generateDeviceFingerprint: generateDeviceFingerprintMock,
  getDeviceInfo: getDeviceInfoMock,
  getLocationFromIp: getLocationFromIpMock,
  getSessionMaxAge: getSessionMaxAgeMock,
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
          login_method: 'google',
        },
        returnPath: '/client-portal/dashboard',
      },
    });
    getClientIpMock.mockReturnValue('203.0.113.42');
    generateDeviceFingerprintMock.mockReturnValue('device-fingerprint');
    getDeviceInfoMock.mockReturnValue({
      name: 'Chrome on Linux',
      type: 'desktop',
    });
    getLocationFromIpMock.mockResolvedValue(null);
    getSessionMaxAgeMock.mockReturnValue(3600);
    enforceMaxSessionsMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue('session-123');
    updateLocationMock.mockResolvedValue(undefined);
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
        'user-agent': 'Mozilla/5.0 test browser',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify(body),
    });
  }

  it('creates a tracked session, sets the authjs cookie, and returns the redirect path', async () => {
    const startedAt = Date.now();
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

    expect(getClientIpMock).toHaveBeenCalledWith(request);
    expect(generateDeviceFingerprintMock).toHaveBeenCalledWith('Mozilla/5.0 test browser');
    expect(getDeviceInfoMock).toHaveBeenCalledWith('Mozilla/5.0 test browser');
    expect(enforceMaxSessionsMock).toHaveBeenCalledWith(defaultPortalDomain.tenant, 'user-1', 5);
    expect(createSessionMock).toHaveBeenCalledWith({
      tenant: defaultPortalDomain.tenant,
      user_id: 'user-1',
      ip_address: '203.0.113.42',
      user_agent: 'Mozilla/5.0 test browser',
      device_fingerprint: 'device-fingerprint',
      device_name: 'Chrome on Linux',
      device_type: 'desktop',
      location_data: null,
      expires_at: expect.any(Date),
      login_method: 'google',
    });
    const createdSession = createSessionMock.mock.calls[0]?.[0];
    expect(createdSession.expires_at.getTime()).toBeGreaterThanOrEqual(startedAt + 3600 * 1000);
    expect(createdSession.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
    expect(getLocationFromIpMock).toHaveBeenCalledWith('203.0.113.42');

    expect(encodeSessionMock).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'user@example.com',
      tenant: defaultPortalDomain.tenant,
      user_type: 'client',
      login_method: 'google',
      session_id: 'session-123',
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

  it('reuses an existing tracked session from the OTT snapshot', async () => {
    consumeOttMock.mockResolvedValue({
      metadata: {
        userSnapshot: {
          id: 'user-1',
          email: 'user@example.com',
          tenant: defaultPortalDomain.tenant,
          user_type: 'client',
          session_id: 'existing-session',
          login_method: 'azure-ad',
        },
        returnPath: '/client-portal/dashboard',
      },
    });

    const response = await POST(buildRequest({ ott: 'ott-token-123' }));

    expect(response.status).toBe(200);
    expect(enforceMaxSessionsMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(getLocationFromIpMock).not.toHaveBeenCalled();
    expect(encodeSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'existing-session',
      login_method: 'azure-ad',
    }));
  });

  it('fails closed when the tracked session cannot be created', async () => {
    createSessionMock.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(buildRequest({ ott: 'ott-token-123' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'exchange_failed' });
    expect(encodeSessionMock).not.toHaveBeenCalled();
    expect(buildSessionCookieMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('uses credentials as the login method when the OTT snapshot omits it', async () => {
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

    const response = await POST(buildRequest({ ott: 'ott-token-123' }));

    expect(response.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      login_method: 'credentials',
    }));
    expect(encodeSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      login_method: 'credentials',
      session_id: 'session-123',
    }));
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

  it('skips dns verification for active domains even when enforcement is enabled', async () => {
    process.env.PORTAL_DOMAIN_DNS_CHECK = 'true';
    // Simulate a custom domain fronted by a proxy (e.g. Cloudflare "orange cloud")
    // where the CNAME is no longer resolvable. An already-active domain was verified
    // at registration time, so the login must still finalize without re-resolving DNS.
    resolveCnameMock.mockRejectedValue(new Error('ENODATA'));

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
