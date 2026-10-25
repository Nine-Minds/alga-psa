import { beforeEach, describe, expect, it, vi } from 'vitest';

// T010 (server half): the express session gate and the Next middleware both refuse a
// session whose type is 'service'. The service type must not fall through to the
// client portal ("not internal") nor to MSP ("not client").
const m = vi.hoisted(() => ({ token: null as any, isRevoked: vi.fn() }));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => m.token),
  decode: vi.fn(async () => m.token),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => 'secret' }),
}));
vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: { isRevokedOrIdentityMismatch: (...a: unknown[]) => m.isRevoked(...a) },
}));
vi.mock('server/src/lib/auth/sessionCookies', () => ({ getSessionCookieName: () => 'authjs.session-token' }));
vi.mock('../../lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: {} }));
vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

import { sessionAuthMiddleware } from '../../middleware/express/authMiddleware';
import middleware from 'server/src/middleware';
import { NextRequest } from 'next/server';

function expressCall(path: string) {
  const req: any = { path, originalUrl: path, cookies: { 'authjs.session-token': 'jwt' }, headers: {}, get: () => undefined };
  const res: any = { redirect: vi.fn(), clearCookie: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

describe('T010: sessionAuthMiddleware', () => {
  beforeEach(() => {
    m.isRevoked.mockReset().mockResolvedValue(false);
  });

  it.each(['/msp/dashboard', '/client-portal/dashboard'])('rejects a service-typed token on %s before any sessions lookup', async (path) => {
    m.token = { id: 'u1', tenant: 't1', session_id: 's1', user_type: 'service' };
    const { req, res, next } = expressCall(path);
    await sessionAuthMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(String(res.redirect.mock.calls[0][0])).toMatch(/signin/);
    expect(String(res.redirect.mock.calls[0][0])).toMatch(/SessionTypeMismatch/);
    expect(m.isRevoked).not.toHaveBeenCalled();
  });

  it('lets a live internal session through on MSP routes', async () => {
    m.token = { id: 'u1', tenant: 't1', session_id: 's1', user_type: 'internal' };
    const { req, res, next } = expressCall('/msp/dashboard');
    await sessionAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});

function nextReq(path: string, userType: string) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  return Object.assign(req, { auth: { user: { id: 'user', tenant: 'tenant', user_type: userType } } });
}
const run = async (req: ReturnType<typeof nextReq>) =>
  (middleware as unknown as (r: ReturnType<typeof nextReq>) => Promise<Response>)(req);

describe('T010: Next middleware', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
  });

  it('sends a service session on /msp to MSP sign-in, not the client portal', async () => {
    const res = await run(nextReq('/msp/dashboard', 'service'));
    const target = new URL(res.headers.get('location')!);
    expect(target.pathname).toBe('/auth/msp/signin');
    expect(target.searchParams.get('error')).toBe('AccessDenied');
  });

  it('sends a service session on /client-portal to client sign-in, not through', async () => {
    const res = await run(nextReq('/client-portal/dashboard', 'service'));
    const target = new URL(res.headers.get('location')!);
    expect(target.pathname).toBe('/auth/client-portal/signin');
    expect(target.searchParams.get('error')).toBe('AccessDenied');
  });

  it('keeps existing behaviour: client on /msp goes to the client dashboard; internal on /msp passes', async () => {
    const client = await run(nextReq('/msp/dashboard', 'client'));
    expect(new URL(client.headers.get('location')!).pathname).toBe('/client-portal/dashboard');
    const internal = await run(nextReq('/msp/dashboard', 'internal'));
    expect(internal.headers.get('location')).toBeNull();
  });
});
