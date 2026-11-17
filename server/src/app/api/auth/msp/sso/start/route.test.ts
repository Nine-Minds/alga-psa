import { beforeEach, describe, expect, it, vi } from 'vitest';

// The canonical-host entry point for MSP SSO begun on a custom domain
// (alga-2026-0002996): cookie and redirect handling.

const cookieJar: any[] = [];
const resolveMock = vi.fn();
const discoveryMock = vi.fn(async () => ({ source: 'app', domain: 'acme.test', providers: ['google'] }));
const signInMock = vi.fn();
const getPortalDomainByHostnameMock = vi.fn();

vi.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => data }),
    redirect: (url: URL | string) => ({
      status: 307,
      headers: { location: String(url) },
      cookies: { set: (cookie: any) => cookieJar.push(cookie) },
    }),
  },
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/auth/nextauth/auth', () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));
vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  MSP_SSO_RESOLUTION_TTL_SECONDS: 300,
  getMspSsoSigningSecret: async () => 'unit-test-signing-secret',
  isSupportedProvider: (value: string) => ['google', 'azure-ad', 'keycloak'].includes(value),
}));
vi.mock('@alga-psa/auth/lib/sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
}));
vi.mock('@alga-psa/auth/lib/mspRememberedEmail', () => ({
  buildClearedPendingRememberContextCookie: () => ({ name: 'msp_pending_remember_context', value: '', maxAge: 0 }),
  buildPendingRememberContextCookie: (value: string) => ({ name: 'msp_pending_remember_context', value, maxAge: 600 }),
}));
vi.mock('server/src/models/PortalDomainModel', () => ({
  normalizeHostname: (host: string) => host.trim().toLowerCase(),
  getPortalDomainByHostname: (...args: unknown[]) => getPortalDomainByHostnameMock(...args),
}));
vi.mock('server/src/lib/auth/mspSsoResolve', () => ({
  resolveMspSso: (...args: unknown[]) => resolveMock(...args),
  buildMspSsoDiscoveryFromEmail: (...args: unknown[]) => discoveryMock(...(args as [])),
  getRequestIpFromHeaders: () => '203.0.113.9',
}));

const { MSP_SSO_HANDOFF_COOKIE, parseAndVerifyMspSsoHandoffCookie } = await import(
  '../../../../../../../../packages/auth/src/lib/sso/mspSsoHandoff'
);
const { GET } = await import('./route');

const CANONICAL = 'https://app.alga.test';

function startRequest(params: Record<string, string>) {
  const url = new URL('/api/auth/msp/sso/start', CANONICAL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const request: any = new Request(url);
  request.nextUrl = url;
  return request;
}

const cookie = (name: string) => cookieJar.find((c) => c.name === name);

beforeEach(() => {
  cookieJar.length = 0;
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = CANONICAL;
  resolveMock.mockResolvedValue({
    ok: true,
    provider: 'google',
    email: 'tech@acme.test',
    source: 'app',
    resolutionCookieValue: 'signed-resolution',
    pendingRememberContextCookieValue: 'signed-pending',
  });
  getPortalDomainByHostnameMock.mockResolvedValue({ domain: 'msp.acme.test', status: 'active', surface: 'both', tenant: 't1' });
  signInMock.mockImplementation(async () => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' });
  });
});

describe('GET /api/auth/msp/sso/start: step 1 (resolve, remember the custom domain)', () => {
  it('runs the shared resolution with the email and a discovery derived on the canonical host', async () => {
    await GET(startRequest({ provider: 'google', email: 'tech@acme.test', domain: 'msp.acme.test', return: '/msp/tickets' }));

    expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      email: 'tech@acme.test',
      callbackUrl: '/msp/tickets',
      discovery: { source: 'app', domain: 'acme.test', providers: ['google'] },
      ip: '203.0.113.9',
    }));
  });

  it('sets host-only resolution cookies and a signed handoff cookie for an active MSP domain, then continues to step 2 on the canonical host', async () => {
    const response: any = await GET(startRequest({ provider: 'google', email: 'tech@acme.test', domain: 'msp.acme.test', return: '/msp/tickets?view=mine' }));

    expect(response.status).toBe(307);
    const next = new URL(response.headers.location);
    expect(next.origin).toBe(CANONICAL);
    expect(next.pathname).toBe('/api/auth/msp/sso/start');
    expect(next.searchParams.get('step')).toBe('authorize');
    expect(next.searchParams.get('provider')).toBe('google');
    expect(next.searchParams.get('return')).toBe('/msp/tickets?view=mine');

    expect(cookie('msp_sso_resolution')).toMatchObject({ value: 'signed-resolution', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 300 });
    // No Domain attribute: the cookie stays host-only on the canonical host.
    expect(cookie('msp_sso_resolution')).not.toHaveProperty('domain');

    const handoff = cookie(MSP_SSO_HANDOFF_COOKIE);
    expect(handoff).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(handoff).not.toHaveProperty('domain');
    expect(parseAndVerifyMspSsoHandoffCookie({ value: handoff.value, secret: 'unit-test-signing-secret' })).toMatchObject({
      domain: 'msp.acme.test',
      returnPath: '/msp/tickets?view=mine',
    });
    // A forged value does not verify.
    expect(parseAndVerifyMspSsoHandoffCookie({ value: handoff.value, secret: 'other-secret' })).toBeNull();
  });

  it('matches a custom host on a non-default port against its port-less domain row and keeps the port for the handoff', async () => {
    getPortalDomainByHostnameMock.mockImplementation(async (_knex: unknown, hostname: string) =>
      hostname === 'msp.acme.test' ? { domain: 'msp.acme.test', status: 'active', surface: 'both', tenant: 't1' } : null,
    );

    await GET(startRequest({ provider: 'google', email: 'tech@acme.test', domain: 'msp.acme.test:3001', return: '/msp/tickets' }));

    expect(getPortalDomainByHostnameMock.mock.calls.map((call) => call[1])).toEqual(['msp.acme.test:3001', 'msp.acme.test']);
    expect(parseAndVerifyMspSsoHandoffCookie({ value: cookie(MSP_SSO_HANDOFF_COOKIE).value, secret: 'unit-test-signing-secret' })).toMatchObject({
      domain: 'msp.acme.test:3001',
    });
  });

  it.each([
    ['inactive', { domain: 'msp.acme.test', status: 'deploying', surface: 'both' }],
    ['client_portal-only', { domain: 'msp.acme.test', status: 'active', surface: 'client_portal' }],
    ['unknown', null],
  ])('does not remember a %s target domain: sign-in continues on the canonical host', async (_label, record) => {
    getPortalDomainByHostnameMock.mockResolvedValue(record);

    const response: any = await GET(startRequest({ provider: 'google', email: 'tech@acme.test', domain: 'msp.acme.test', return: '/msp/tickets' }));

    expect(new URL(response.headers.location).searchParams.get('step')).toBe('authorize');
    expect(cookie('msp_sso_resolution')).toBeDefined();
    // The handoff cookie is cleared (empty, maxAge 0), never set to a domain.
    expect(cookie(MSP_SSO_HANDOFF_COOKIE)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('replaces an unsafe return path with the MSP dashboard', async () => {
    for (const unsafe of ['https://evil.test/msp', '//evil.test', '/client-portal/dashboard', '/api/v1/users']) {
      cookieJar.length = 0;
      const response: any = await GET(startRequest({ provider: 'google', email: 'tech@acme.test', domain: 'msp.acme.test', return: unsafe }));
      expect(new URL(response.headers.location).searchParams.get('return'), unsafe).toBe('/msp/dashboard');
    }
  });

  it('sends a failed resolution back to the originating sign-in page without leaving cookies behind', async () => {
    resolveMock.mockResolvedValue({ ok: false });

    const response: any = await GET(startRequest({ provider: 'google', email: 'nobody@acme.test', domain: 'msp.acme.test', return: '/msp/tickets' }));

    const location = new URL(response.headers.location);
    expect(location.origin).toBe('https://msp.acme.test');
    expect(location.pathname).toBe('/auth/msp/signin');
    expect(location.searchParams.get('callbackUrl')).toBe('/msp/tickets');
    expect(location.searchParams.get('error')).toBe('Configuration');
    expect(cookie('msp_sso_resolution')).toMatchObject({ value: '', maxAge: 0 });
    expect(cookie(MSP_SSO_HANDOFF_COOKIE)).toMatchObject({ value: '', maxAge: 0 });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('refuses an unsupported provider without resolving', async () => {
    const response: any = await GET(startRequest({ provider: 'github', email: 'tech@acme.test', domain: 'msp.acme.test' }));
    expect(new URL(response.headers.location).pathname).toBe('/auth/msp/signin');
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/msp/sso/start: step 2 (start OAuth on the canonical host)', () => {
  it('starts the OAuth request through NextAuth with the canonical return path', async () => {
    await expect(
      GET(startRequest({ provider: 'google', step: 'authorize', return: '/msp/tickets' }))
    ).rejects.toMatchObject({ digest: 'NEXT_REDIRECT' });

    expect(signInMock).toHaveBeenCalledWith(
      'google',
      { redirectTo: '/msp/tickets' },
      expect.objectContaining({ state: expect.any(String) })
    );
    const state = JSON.parse((signInMock.mock.calls[0][2] as { state: string }).state);
    expect(state).toMatchObject({ mode: 'login', user_type: 'internal', callback_url: '/msp/tickets' });
    // Step 2 never re-resolves or touches the handoff cookie.
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('sanitises the return path here too', async () => {
    await expect(
      GET(startRequest({ provider: 'azure-ad', step: 'authorize', return: '//evil.test' }))
    ).rejects.toBeDefined();
    expect(signInMock.mock.calls[0][1]).toEqual({ redirectTo: '/msp/dashboard' });
  });

  it('uses the fake Google completion on the canonical host when the e2e flag is on', async () => {
    process.env.PLAYWRIGHT_FAKE_GOOGLE_OAUTH = 'true';
    try {
      const response: any = await GET(startRequest({ provider: 'google', step: 'authorize', return: '/msp/tickets' }));
      const location = new URL(response.headers.location);
      expect(location.origin).toBe(CANONICAL);
      expect(location.pathname).toBe('/api/auth/e2e/google/complete');
      expect(location.searchParams.get('callbackUrl')).toBe('/msp/tickets');
      expect(signInMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.PLAYWRIGHT_FAKE_GOOGLE_OAUTH;
    }
  });
});
