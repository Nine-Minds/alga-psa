import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
import middleware, { isPublicPagePath } from 'server/src/middleware';

async function run(path: string) {
  const req = Object.assign(new NextRequest(`http://localhost:3000${path}`), { auth: null });
  return await (middleware as unknown as (r: typeof req) => Promise<Response>)(req);
}

describe('public /pay/<token> middleware allowance', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('allows exactly one base64url segment under /pay/', () => {
    expect(isPublicPagePath('/pay/AbC-_123')).toBe(true);
    expect(isPublicPagePath('/payment-methods/setup-complete')).toBe(true);
    for (const p of ['/pay', '/pay/', '/pay/a/b', '/pay/a.b', '/pay/%2e%2e', '/pay/..', '/payx/abc', '/msp/pay/abc', '/pay/' + 'a'.repeat(513)]) {
      expect(isPublicPagePath(p), p).toBe(false);
    }
  });

  it('serves an unauthenticated /pay/<token> request without redirecting to sign-in', async () => {
    const response = await run('/pay/AbC-_123');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('still redirects unauthenticated MSP requests', async () => {
    const response = await run('/msp/dashboard');
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });
});
