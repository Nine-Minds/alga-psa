/**
 * alga-2026-0002799: drives the REAL middleware for requests on a tenant's custom domain.
 *
 * next-auth's `auth()` wrapper rewrites request.nextUrl to NEXTAUTH_URL, so every request
 * here is built the way the middleware actually sees it: nextUrl on the canonical origin,
 * the browser's host only in the Host header. The boundary under test is "signed in on the
 * custom host, then navigate to the other app" and the same-host `both` case.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { surfaces } = vi.hoisted(() => ({ surfaces: {} as Record<string, string> }));

// The global setup stubs next/server; the middleware's redirects and NextResponse.next()
// must be the real ones here.
vi.unmock('next/server');

// Pass-through edge auth: the test sets request.auth itself (the session the cookie decoded to).
vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({
  auth: (handler: (req: any) => unknown) => (req: any) => handler(req),
}));

// The Edge -> Node surface lookup; only ACTIVE domains answer (null otherwise).
vi.mock('server/src/lib/portal-domains/hostSurface', () => ({
  resolveHostSurface: vi.fn(async (hostname: string) => surfaces[hostname] ?? null),
}));

import middleware from 'server/src/middleware';

const CANONICAL = 'https://algapsa.com';
const ENV_KEYS = ['NEXTAUTH_URL', 'NEXTAUTH_SECRET'] as const;
const savedEnv: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

type Session = { user: { user_type: 'internal' | 'client'; tenant: string; id: string; product_code?: string } } | null;
const tech: Session = { user: { user_type: 'internal', tenant: 'tenant-pbnj', id: 'u-tech' } };
const contact: Session = { user: { user_type: 'client', tenant: 'tenant-pbnj', id: 'u-contact' } };

async function visit(host: string, path: string, session: Session) {
  const request = new NextRequest(`${CANONICAL}${path}`, {
    headers: { host, 'x-forwarded-proto': 'https', accept: 'text/html' },
  }) as NextRequest & { auth: Session };
  request.auth = session;
  const response = (await (middleware as any)(request, {} as any)) as Response;
  return { status: response.status, location: response.headers.get('location') };
}

beforeAll(() => {
  process.env.NEXTAUTH_URL = CANONICAL;
  process.env.NEXTAUTH_SECRET = 'boundary-test-secret';
});

afterAll(() => {
  // Restore key by key; never replace the shared process.env object.
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  for (const key of Object.keys(surfaces)) delete surfaces[key];
  surfaces['helpdesk.pbnj.ca'] = 'msp';
  surfaces['both.pbnj.ca'] = 'both';
  surfaces['portal.pbnj.ca'] = 'client_portal';
});

describe('custom MSP host: sign-in stays on the custom host', () => {
  it('sends an unauthenticated technician to /auth/signin on the CUSTOM host, not the canonical one', async () => {
    const result = await visit('helpdesk.pbnj.ca', '/msp/dashboard', null);
    expect(result.status).toBe(307);
    const location = new URL(result.location!);
    expect(location.origin).toBe('https://helpdesk.pbnj.ca');
    expect(location.pathname).toBe('/auth/signin');
    expect(location.searchParams.get('callbackUrl')).toBe('/msp/dashboard');
  });

  it('serves the MSP app in place to a technician signed in on the custom host', async () => {
    const result = await visit('helpdesk.pbnj.ca', '/msp/dashboard', tech);
    expect(result.location).toBeNull();
    expect(result.status).toBe(200);
  });
});

describe('boundary: signed in on the custom host, then navigating to the portal', () => {
  it('msp host: /client-portal is never served; the technician stays on the custom host', async () => {
    const result = await visit('helpdesk.pbnj.ca', '/client-portal/dashboard', tech);
    expect(result.status).toBe(307);
    expect(result.location).toBe('https://helpdesk.pbnj.ca/msp/dashboard');
  });

  it('msp host: the portal sign-in page sends the user to the MSP sign-in on the same host', async () => {
    const result = await visit('helpdesk.pbnj.ca', '/auth/client-portal/signin', null);
    expect(result.status).toBe(307);
    expect(result.location).toBe('https://helpdesk.pbnj.ca/auth/signin');
  });

  it('client_portal host: an internal user is still evicted to the canonical MSP app (legacy behaviour kept)', async () => {
    const result = await visit('portal.pbnj.ca', '/client-portal/dashboard', tech);
    expect(result.status).toBe(307);
    expect(result.location).toBe(`${CANONICAL}/msp/dashboard`);
  });

  it('client_portal host: /msp is not served on the vanity host', async () => {
    const result = await visit('portal.pbnj.ca', '/msp/dashboard', tech);
    expect(result.status).toBe(307);
    expect(result.location).toBe(`${CANONICAL}/msp/dashboard`);
  });

  it('unknown or inactive host fails closed: /msp goes to the canonical host', async () => {
    const result = await visit('pending.pbnj.ca', '/msp/dashboard', tech);
    expect(result.status).toBe(307);
    expect(result.location).toBe(`${CANONICAL}/msp/dashboard`);
  });
});

describe('same host, surface=both (path routing on one domain)', () => {
  it('serves the MSP app to a technician', async () => {
    const result = await visit('both.pbnj.ca', '/msp/dashboard', tech);
    expect(result.location).toBeNull();
    expect(result.status).toBe(200);
  });

  it('serves the client portal to a contact on the same host', async () => {
    const result = await visit('both.pbnj.ca', '/client-portal/dashboard', contact);
    expect(result.location).toBeNull();
    expect(result.status).toBe(200);
  });

  it('a technician who navigates to /client-portal goes to the MSP app on the SAME host', async () => {
    const result = await visit('both.pbnj.ca', '/client-portal/dashboard', tech);
    expect(result.status).toBe(307);
    expect(result.location).toBe('https://both.pbnj.ca/msp/dashboard');
  });

  it('a contact who navigates to /msp goes to the portal on the SAME host', async () => {
    const result = await visit('both.pbnj.ca', '/msp/dashboard', contact);
    expect(result.status).toBe(307);
    expect(result.location).toBe('https://both.pbnj.ca/client-portal/dashboard');
  });

  it('keeps a co-managed client principal out of MSP billing', async () => {
    const client: Session = { user: { user_type: 'client', tenant: 'customer', id: 'client', product_code: 'co_managed' } };
    const result = await visit('both.pbnj.ca', '/msp/billing', client);
    expect(result.status).toBe(307);
    expect(result.location).toBe('https://both.pbnj.ca/client-portal/dashboard');
  });
});
