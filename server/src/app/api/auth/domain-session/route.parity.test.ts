import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@auth/core/jwt';

// T004 (alga-2026-0002996): session parity. The exchange mints with the SAME function the
// NextAuth jwt callback uses on a direct sign-in, so the cookie it sets decodes to exactly
// what that function produces for the user - subscription/plan claims, tier, tenant, user
// type, login method and tracked session id included. Nothing about the user is carried in
// the OTT; the real minting, loading and encoding code runs here, with only the database
// boundary faked.

const SECRET = 'parity-test-secret';
const TENANT = '3f2c9a5e-1b7d-4c6a-8e4f-2d9b6a1c0e77';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  ott: null as any,
  consumed: false,
  createdSessions: [] as any[],
  cookies: [] as any[],
}));

class FakeQuery {
  private filters: Array<(row: any) => boolean> = [];
  constructor(private readonly table: string) {}
  where(criteria: Record<string, unknown> | string, value?: unknown) {
    const entries = typeof criteria === 'string' ? [[criteria, value] as const] : Object.entries(criteria);
    this.filters.push((row) => entries.every(([key, expected]) => row[key.split('.').pop() as string] === expected));
    return this;
  }
  whereIn() { return this; }
  select() { return this; }
  orderByRaw() { return this; }
  private run() {
    return (db.rows[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)));
  }
  first() { return this.run()[0]; }
  then(resolve: (rows: any[]) => unknown, reject?: (e: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}
const fakeKnex: any = (table: string) => new FakeQuery(table);

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
      cookies: { set: (cookie: any) => db.cookies.push(cookie) },
    }),
  },
}));
vi.mock('next/headers.js', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('node:dns', () => ({ promises: { resolveCname: vi.fn() } }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => fakeKnex }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: async () => null,
  resolveSelfHostTier: () => null,
}));
vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    enforceMaxSessions: vi.fn(async () => undefined),
    create: vi.fn(async (input: any) => {
      db.createdSessions.push(input);
      return 'session-from-db';
    }),
    updateLocation: vi.fn(async () => undefined),
  },
}));
vi.mock('server/src/models/PortalDomainModel', () => ({
  normalizeHostname: (host: string) => host.toLowerCase(),
  getPortalDomainByHostname: async () => ({
    id: 'domain-1',
    tenant: TENANT,
    domain: 'msp.example.com',
    canonicalHost: 'tenant.portal.host',
    status: 'active',
    surface: 'both',
    verificationDetails: {},
  }),
}));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // One-time-token storage is covered by the OTT tests; here it just yields the stored record once.
  consumePortalDomainOtt: async () => {
    if (db.consumed) return null;
    db.consumed = true;
    return db.ott;
  },
}));

const { POST } = await import('./route');
const { mintSessionToken, loadSessionUser } = await import('../../../../../../packages/auth/src/lib/sessionTokenMinting');
const { getSessionCookieConfig } = await import('../../../../../../packages/auth/src/lib/session');

// Time-derived claims differ between two mints a moment apart; everything else must match.
const TIME_CLAIMS = ['auth_issued_at', 'last_plan_check', 'iat', 'exp', 'jti'] as const;
function withoutTimeClaims(token: Record<string, unknown>) {
  const copy = { ...token };
  for (const claim of TIME_CLAIMS) delete copy[claim];
  return copy;
}

function exchangeRequest(body: Record<string, unknown>) {
  return new Request('https://msp.example.com/api/auth/domain-session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'msp.example.com',
      'user-agent': 'Mozilla/5.0 parity test',
      'x-forwarded-for': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  process.env.PORTAL_DOMAIN_DNS_CHECK = 'false';
  db.consumed = false;
  db.createdSessions = [];
  db.cookies = [];
  db.rows = {
    users: [{
      user_id: 'tech-1',
      tenant: TENANT,
      email: 'tech@acme.test',
      username: 'tech',
      first_name: 'Tess',
      last_name: 'Tech',
      user_type: 'internal',
      is_inactive: false,
      icon: null,
      contact_id: null,
    }],
    tenants: [{ tenant: TENANT, plan: 'pro', product_code: 'psa' }],
    stripe_subscriptions: [{
      tenant: TENANT,
      status: 'trialing',
      current_period_end: new Date('2027-01-01T00:00:00Z'),
      metadata: {},
    }],
    tenant_addons: [{ tenant: TENANT, addon_key: 'ai_assistant', expires_at: null }],
  };
  db.ott = {
    tenant: TENANT,
    userId: 'tech-1',
    metadata: { surface: 'msp', returnPath: '/msp/tickets', loginMethod: 'google', targetDomain: 'msp.example.com' },
  };
});

describe('domain-session exchange: session parity with a direct sign-in (T004)', () => {
  it('sets a cookie whose token equals the shared minting function output, plan claims included', async () => {
    const response = await POST(exchangeRequest({ ott: 'ott-1', returnPath: '/msp/tickets' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: '/msp/tickets', canonicalHost: 'tenant.portal.host' });
    expect(db.cookies).toHaveLength(1);

    const exchanged = await decode({
      token: db.cookies[0].value,
      secret: SECRET,
      salt: getSessionCookieConfig().name,
    });
    expect(exchanged).not.toBeNull();

    // What a direct sign-in would mint for this user (the jwt callback calls this function).
    const user = await loadSessionUser(TENANT, 'tech-1');
    const direct = await mintSessionToken({
      token: {},
      user: user!,
      loginMethod: 'google',
      sessionId: 'session-from-db',
    });

    expect(withoutTimeClaims(exchanged as Record<string, unknown>)).toEqual(withoutTimeClaims(direct));

    // Spot-check the claims the old per-surface snapshot could not carry.
    expect(exchanged).toMatchObject({
      id: 'tech-1',
      sub: 'tech-1',
      tenant: TENANT,
      user_type: 'internal',
      plan: 'pro',
      product_code: 'psa',
      addons: ['ai_assistant'],
      subscription_status: 'trialing',
      trial_end: '2027-01-01T00:00:00.000Z',
      login_method: 'google',
      session_id: 'session-from-db',
    });
    expect(typeof (exchanged as any).last_plan_check).toBe('number');
    expect(typeof (exchanged as any).auth_issued_at).toBe('number');
    expect(db.createdSessions).toHaveLength(1);
    expect(db.createdSessions[0]).toMatchObject({ tenant: TENANT, user_id: 'tech-1', login_method: 'google' });
  });

  it('consumes the OTT once: a second exchange of the same token fails and sets no cookie', async () => {
    const first = await POST(exchangeRequest({ ott: 'ott-1' }));
    expect(first.status).toBe(200);
    expect(db.cookies).toHaveLength(1);

    const second = await POST(exchangeRequest({ ott: 'ott-1' }));
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe('invalid_or_expired');
    expect(db.cookies).toHaveLength(1);
    expect(db.createdSessions).toHaveLength(1);
  });

  it("redirects to the OTT's MSP return path, defaulting to /msp/dashboard", async () => {
    const withPath = await POST(exchangeRequest({ ott: 'ott-1' }));
    expect((await withPath.json()).redirectTo).toBe('/msp/tickets');

    db.consumed = false;
    db.ott = { ...db.ott, metadata: { ...db.ott.metadata, returnPath: undefined } };
    const withoutPath = await POST(exchangeRequest({ ott: 'ott-1' }));
    expect((await withoutPath.json()).redirectTo).toBe('/msp/dashboard');
  });
});
