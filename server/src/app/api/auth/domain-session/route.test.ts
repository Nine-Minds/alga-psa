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
const loadSessionUserMock = vi.fn();
const mintSessionTokenMock = vi.fn();
const enforceMaxSessionsMock = vi.fn();
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
  loadSessionUser: loadSessionUserMock,
  mintSessionToken: mintSessionTokenMock,
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
  surface: 'both',
  verificationDetails: { expected_cname: 'canonical.cdn.net' },
};

const clientUser = {
  id: 'user-1',
  email: 'user@example.com',
  tenant: defaultPortalDomain.tenant,
  user_type: 'client',
  clientId: 'client-1',
};
const internalUser = {
  id: 'tech-1',
  email: 'tech@example.com',
  tenant: defaultPortalDomain.tenant,
  user_type: 'internal',
};

function ottRecord(overrides: { surface?: string; userId?: string; tenant?: string; returnPath?: string; loginMethod?: string | undefined } = {}) {
  return {
    tenant: overrides.tenant ?? defaultPortalDomain.tenant,
    userId: overrides.userId ?? 'user-1',
    metadata: {
      surface: overrides.surface ?? 'client_portal',
      returnPath: overrides.returnPath ?? '/client-portal/dashboard',
      loginMethod: 'loginMethod' in overrides ? overrides.loginMethod : 'google',
      targetDomain: defaultPortalDomain.domain,
    },
  };
}

describe('portal domain session exchange (surface-neutral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.PORTAL_DOMAIN_DNS_CHECK = 'true';
    resolveCnameMock.mockResolvedValue(['canonical.cdn.net']);
    getAdminConnectionMock.mockResolvedValue({});
    getPortalDomainByHostnameMock.mockResolvedValue(defaultPortalDomain);
    consumeOttMock.mockResolvedValue(ottRecord());
    loadSessionUserMock.mockImplementation(async (_tenant: string, userId: string) =>
      userId === 'tech-1' ? { ...internalUser } : userId === 'user-1' ? { ...clientUser } : undefined,
    );
    mintSessionTokenMock.mockImplementation(async ({ user, loginMethod }: any) => ({
      id: user.id,
      tenant: user.tenant,
      user_type: user.user_type,
      session_id: 'session-123',
      login_method: loginMethod,
    }));
    getClientIpMock.mockReturnValue('203.0.113.42');
    generateDeviceFingerprintMock.mockReturnValue('device-fingerprint');
    getDeviceInfoMock.mockReturnValue({
      name: 'Chrome on Linux',
      type: 'desktop',
    });
    enforceMaxSessionsMock.mockResolvedValue(undefined);
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
    return new Request(`${protocol}://portal.example.com/api/auth/domain-session`, {
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

  it('mints a tracked session for a client user through the shared minting function and sets the cookie', async () => {
    const request = buildRequest({
      ott: 'ott-token-123',
      returnPath: '/client-portal/dashboard',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectTo: '/client-portal/dashboard',
      canonicalHost: defaultPortalDomain.canonicalHost,
    });

    expect(loadSessionUserMock).toHaveBeenCalledWith(defaultPortalDomain.tenant, 'user-1');
    expect(enforceMaxSessionsMock).toHaveBeenCalledWith(defaultPortalDomain.tenant, 'user-1', 5);
    expect(mintSessionTokenMock).toHaveBeenCalledTimes(1);
    expect(mintSessionTokenMock).toHaveBeenCalledWith({
      token: {},
      user: {
        ...clientUser,
        deviceInfo: {
          ip: '203.0.113.42',
          userAgent: 'Mozilla/5.0 test browser',
          deviceFingerprint: 'device-fingerprint',
          deviceName: 'Chrome on Linux',
          deviceType: 'desktop',
          locationData: null,
        },
      },
      loginMethod: 'google',
    });

    // The cookie carries exactly what the minting function returned.
    expect(encodeSessionMock).toHaveBeenCalledWith(await mintSessionTokenMock.mock.results[0].value);
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

  it('defaults the redirect by user type: /msp/dashboard for internal users, /client-portal/dashboard for clients', async () => {
    const withoutReturnPath = (record: ReturnType<typeof ottRecord>) => ({
      ...record,
      metadata: { ...record.metadata, returnPath: undefined },
    });
    consumeOttMock.mockResolvedValue(withoutReturnPath(ottRecord({ surface: 'msp', userId: 'tech-1' })));
    const internal = await POST(buildRequest({ ott: 'ott-token-123' }));
    expect((await internal.json()).redirectTo).toBe('/msp/dashboard');

    consumeOttMock.mockResolvedValue(withoutReturnPath(ottRecord()));
    const client = await POST(buildRequest({ ott: 'ott-token-123' }));
    expect((await client.json()).redirectTo).toBe('/client-portal/dashboard');
  });

  it('redirects an internal user to the requested MSP return path', async () => {
    consumeOttMock.mockResolvedValue(ottRecord({ surface: 'msp', userId: 'tech-1', returnPath: '/msp/tickets' }));
    const response = await POST(buildRequest({ ott: 'ott-token-123', returnPath: '/msp/tickets?view=mine' }));
    expect(response.status).toBe(200);
    expect((await response.json()).redirectTo).toBe('/msp/tickets?view=mine');
  });

  it('serves the same handler on the legacy client-portal path', async () => {
    const legacy = await import('../../client-portal/domain-session/route');
    expect(legacy.POST).toBe(POST);
  });

  it('fails closed when no tracked session could be minted', async () => {
    mintSessionTokenMock.mockResolvedValue({ id: 'user-1' });

    const response = await POST(buildRequest({ ott: 'ott-token-123' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'exchange_failed' });
    expect(encodeSessionMock).not.toHaveBeenCalled();
    expect(buildSessionCookieMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('uses credentials as the login method when the OTT omits it', async () => {
    consumeOttMock.mockResolvedValue(ottRecord({ loginMethod: undefined }));

    const response = await POST(buildRequest({ ott: 'ott-token-123' }));

    expect(response.status).toBe(200);
    expect(mintSessionTokenMock).toHaveBeenCalledWith(expect.objectContaining({ loginMethod: 'credentials' }));
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

  it.each([
    'https://malicious.invalid',
    '//malicious.invalid/client-portal/x',
    '/\\malicious.invalid',
    '/client-portal/../msp/dashboard',
    '/msp/dashboard',
  ])('falls back to the default dashboard when the return path %s is unsafe or outside the surface', async (returnPath) => {
    const response = await POST(buildRequest({ ott: 'ott-token-123', returnPath }));
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

  // T005 (alga-2026-0002996)
  describe('guards', () => {
    it("refuses an OTT whose tenant does not own the requesting domain", async () => {
      consumeOttMock.mockResolvedValue(ottRecord({ tenant: 'tenant-other' }));

      const response = await POST(buildRequest({ ott: 'ott-token-123' }));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('tenant_mismatch');
      expect(mintSessionTokenMock).not.toHaveBeenCalled();
      expect(setCookieMock).not.toHaveBeenCalled();
    });

    it('refuses an MSP OTT on a client_portal-only domain', async () => {
      getPortalDomainByHostnameMock.mockResolvedValue({ ...defaultPortalDomain, surface: 'client_portal' });
      consumeOttMock.mockResolvedValue(ottRecord({ surface: 'msp', userId: 'tech-1', returnPath: '/msp/dashboard' }));

      const response = await POST(buildRequest({ ott: 'ott-token-123', returnPath: '/msp/dashboard' }));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('surface_not_served');
      expect(mintSessionTokenMock).not.toHaveBeenCalled();
      expect(setCookieMock).not.toHaveBeenCalled();
    });

    it('refuses an /msp return path on a client_portal-only domain even for a client OTT', async () => {
      getPortalDomainByHostnameMock.mockResolvedValue({ ...defaultPortalDomain, surface: 'client_portal' });

      const response = await POST(buildRequest({ ott: 'ott-token-123', returnPath: '/msp/dashboard' }));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('surface_not_served');
      expect(setCookieMock).not.toHaveBeenCalled();
    });

    it('refuses a client_portal return path on an msp-only domain', async () => {
      getPortalDomainByHostnameMock.mockResolvedValue({ ...defaultPortalDomain, surface: 'msp' });
      consumeOttMock.mockResolvedValue(ottRecord({ surface: 'msp', userId: 'tech-1' }));

      const response = await POST(buildRequest({ ott: 'ott-token-123', returnPath: '/client-portal/dashboard' }));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('surface_not_served');
    });

    it('refuses a token whose user is not of the token surface (client user on an msp OTT)', async () => {
      consumeOttMock.mockResolvedValue(ottRecord({ surface: 'msp', userId: 'user-1' }));

      const response = await POST(buildRequest({ ott: 'ott-token-123' }));

      expect(response.status).toBe(400);
      expect(mintSessionTokenMock).not.toHaveBeenCalled();
      expect(setCookieMock).not.toHaveBeenCalled();
    });

    it('refuses a token for a user that no longer exists or is inactive', async () => {
      loadSessionUserMock.mockResolvedValue(undefined);

      const response = await POST(buildRequest({ ott: 'ott-token-123' }));

      expect(response.status).toBe(400);
      expect(mintSessionTokenMock).not.toHaveBeenCalled();
    });
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
