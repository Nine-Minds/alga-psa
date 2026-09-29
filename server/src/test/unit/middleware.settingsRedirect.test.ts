import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
// The broad unit config aliases next/server to a stub. Exercise real HTTP
// request/response objects here so redirects and middleware headers are tested.
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
import middleware from 'server/src/middleware';

function request(path: string, { method = 'GET', userType = 'internal' as string | null, action = false } = {}) {
  const req = new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: action ? { 'next-action': 'real-action-id', 'content-type': 'text/plain' } : undefined,
  });
  return Object.assign(req, { auth: userType ? { user: { id: 'user', tenant: 'tenant', user_type: userType } } : null });
}

async function run(req: ReturnType<typeof request>) {
  return await (middleware as unknown as (req: ReturnType<typeof request>) => Promise<Response>)(req);
}

describe('legacy settings HTTP redirects', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('redirects a legacy OAuth return before rendering and preserves repeated query values', async () => {
    const response = await run(request('/msp/settings?tab=INTEGRATIONS&category=accounting&qbo_status=success&scope=a&scope=b'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/msp/settings/integrations?category=accounting&qbo_status=success&scope=a&scope=b');
    expect(response.headers.get('x-pathname')).toBe('/msp/settings/integrations');
  });

  it.each(['/msp/settings?tab=general', '/msp/settings?tab=unknown', '/msp/settings?tab=integrations&tab=billing', '/msp/settings/integrations?category=accounting'])('does not redirect %s', async path => {
    const response = await run(request(path));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('keeps server-action POST requests on their original route', async () => {
    const response = await run(request('/msp/settings?tab=integrations', { method: 'POST', action: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('keeps unauthenticated requests behind login', async () => {
    const response = await run(request('/msp/settings?tab=integrations', { userType: null }));
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/auth/signin');
    expect(target.searchParams.get('callbackUrl')).toBe('/msp/settings?tab=integrations');
  });

  it('keeps portal users out of MSP settings', async () => {
    const response = await run(request('/msp/settings?tab=integrations', { userType: 'client' }));
    expect(new URL(response.headers.get('location')!).pathname).toBe('/client-portal/dashboard');
  });
});
