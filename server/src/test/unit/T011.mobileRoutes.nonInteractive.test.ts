import { beforeEach, describe, expect, it, vi } from 'vitest';

// T011 (route half): handoff, Apple linked identity, IAP restore and provision refuse
// service users and inactive/non-internal users, and never mint an OTT for them.
const m = vi.hoisted(() => ({
  session: null as any,
  appleIdentity: undefined as any,
  isActiveInternal: true,
  issueMobileOtt: vi.fn(),
  usersWhere: [] as Array<Record<string, unknown>>,
  restoreAdmin: undefined as any,
}));

const ForbiddenError = vi.hoisted(() => class ForbiddenError extends Error { statusCode = 403; });

vi.mock('@alga-psa/auth', () => ({
  getSessionWithRevocationCheck: vi.fn(async () => m.session),
  assertActiveInternalUser: vi.fn(async () => m.isActiveInternal),
}));
vi.mock('@/lib/mobileAuth/mobileAuthService', () => ({ issueMobileOtt: (...a: unknown[]) => m.issueMobileOtt(...a) }));
vi.mock('@/lib/security/mobileAuthRateLimiting', () => ({ enforceMobileOttIssueLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/middleware/apiMiddleware', () => ({
  ForbiddenError,
  UnauthorizedError: class extends Error {},
  ValidationError: class extends Error {},
  NotFoundError: class extends Error {},
  handleApiError: (e: any) => new Response(JSON.stringify({ error: String(e?.message) }), { status: e?.statusCode ?? 500 }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({ fn: { now: () => 'now' } })) }));
vi.mock('@/lib/mobileAuth/appleSignIn', () => ({
  getAppleSignInConfig: vi.fn(async () => ({})),
  verifyAppleIdentityToken: vi.fn(async () => ({ sub: 'apple-sub-1' })),
  exchangeAppleAuthorizationCode: vi.fn(),
  encryptAppleRefreshToken: vi.fn(),
}));
vi.mock('@/lib/iap/appStoreServer', () => ({
  getAppleIapConfig: vi.fn(async () => ({ bundleId: 'b' })),
  getTransactionInfo: vi.fn(async () => ({ bundleId: 'b', originalTransactionId: 'otx-1' })),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    unscoped: (table: string) => {
      const chain: any = {
        where: () => chain,
        first: async () => (table === 'apple_user_identities' ? m.appleIdentity : { tenant: 't1', status: 'active' }),
      };
      return chain;
    },
    table: (table: string) => {
      const chain: any = {
        where: (c: Record<string, unknown>) => { if (table === 'users') m.usersWhere.push(c); return chain; },
        update: async () => 1,
        orderBy: () => chain,
        first: async () => (table === 'users' ? m.restoreAdmin : undefined),
      };
      return chain;
    },
  }),
}));

import { GET as handoff } from '@/app/auth/mobile/handoff/route';
import { POST as apple } from '@/app/api/v1/mobile/auth/apple/route';
import { POST as restore } from '@/app/api/v1/mobile/iap/restore/route';
import { NextRequest } from 'next/server';

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const sessionOf = (user_type: string) => ({ user: { id: 'u1', tenant: 't1', user_type }, session_id: 's1' });
const handoffReq = () => new NextRequest('http://localhost/auth/mobile/handoff?redirect=alga%3A%2F%2Fauth%2Fcallback&state=st');

beforeEach(() => {
  m.session = null;
  m.appleIdentity = undefined;
  m.isActiveInternal = true;
  m.restoreAdmin = undefined;
  m.usersWhere.length = 0;
  m.issueMobileOtt.mockReset().mockResolvedValue({ ott: 'ott-1', expiresAtMs: Date.now() + 60_000 });
});

describe('T011: handoff route', () => {
  it.each(['service', 'client', 'robot'])('refuses a %s session without issuing an OTT', async (type) => {
    m.session = sessionOf(type);
    const res = await handoff(handoffReq());
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('error')).toBe(type === 'client' ? 'client_not_allowed' : 'not_allowed');
    expect(loc.searchParams.has('ott')).toBe(false);
    expect(m.issueMobileOtt).not.toHaveBeenCalled();
  });

  it('turns an inactive internal user (service-level ForbiddenError) into not_allowed', async () => {
    m.session = sessionOf('internal');
    m.issueMobileOtt.mockRejectedValue(new ForbiddenError('no'));
    const res = await handoff(handoffReq());
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('not_allowed');
  });

  it('issues an OTT for an active internal user', async () => {
    m.session = sessionOf('internal');
    const res = await handoff(handoffReq());
    expect(new URL(res.headers.get('location')!).searchParams.get('ott')).toBe('ott-1');
  });
});

describe('T011: Apple sign-in linked identity', () => {
  const body = { identityToken: 'tok', state: 'st' };

  it('refuses an identity linked to a service / inactive / client user (403) and issues no OTT', async () => {
    m.appleIdentity = { apple_user_id: 'apple-sub-1', tenant: 't1', user_id: 'svc-1', email: null, apple_refresh_token_enc: null };
    m.isActiveInternal = false;
    const res = await apple(post('http://localhost/api/v1/mobile/auth/apple', body));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('account_not_allowed');
    expect(m.issueMobileOtt).not.toHaveBeenCalled();
  });

  it('issues an OTT for an identity bound to an active internal user', async () => {
    m.appleIdentity = { apple_user_id: 'apple-sub-1', tenant: 't1', user_id: 'u1', email: null, apple_refresh_token_enc: null };
    const res = await apple(post('http://localhost/api/v1/mobile/auth/apple', body));
    expect(res.status).toBe(200);
    expect(m.issueMobileOtt).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', userId: 'u1' }));
  });
});

describe('T011: IAP restore', () => {
  const body = { originalTransactionId: 'otx-1', state: 'st' };

  it('selects only active internal users, so a tenant with only service/inactive users yields no OTT', async () => {
    m.restoreAdmin = undefined;
    const res = await restore(post('http://localhost/api/v1/mobile/iap/restore', body));
    expect(res.status).not.toBe(200);
    expect(m.usersWhere).toContainEqual({ user_type: 'internal', is_inactive: false });
    expect(m.issueMobileOtt).not.toHaveBeenCalled();
  });

  it('binds the OTT to the selected internal admin', async () => {
    m.restoreAdmin = { user_id: 'admin-1' };
    const res = await restore(post('http://localhost/api/v1/mobile/iap/restore', body));
    expect(res.status).toBe(200);
    expect(m.issueMobileOtt).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', userId: 'admin-1' }));
  });
});
