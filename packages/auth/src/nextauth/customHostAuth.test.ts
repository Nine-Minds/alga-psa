/**
 * alga-2026-0002799 (D3): NextAuth on a tenant's custom MSP domain.
 *
 * next-auth's own route handlers rewrite EVERY request's origin to NEXTAUTH_URL
 * (`reqWithEnvURL`), so on https://helpdesk.pbnj.ca the OAuth redirect_uri, the
 * credentials callback URL and the post-login `baseUrl` all pointed at the canonical
 * host, while state/PKCE/CSRF cookies were set host-only on the custom host and never
 * came back. These tests pin the contract of the custom-host aware handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '@auth/core';
import Credentials from '@auth/core/providers/credentials';
import Google from '@auth/core/providers/google';

import {
  bindAuthConfigToTenant,
  createCustomHostAwareHandler,
  rebaseRequestOntoHost,
  resolveCustomAuthHost,
  clearCustomAuthHostCache,
} from './customHostAuth';

const CANONICAL = 'https://algapsa.com';

function baseConfig() {
  return {
    secret: 'unit-test-secret',
    basePath: '/api/auth',
    providers: [
      Credentials({ credentials: { email: {}, password: {} }, authorize: async () => null }),
      Google({ clientId: 'gid', clientSecret: 'gsecret' }),
    ],
    session: { strategy: 'jwt' as const },
  };
}

describe('rebaseRequestOntoHost', () => {
  it('moves a request onto the custom host, keeping path, query, method, headers and body', async () => {
    const req = new Request(`${CANONICAL}/api/auth/callback/credentials?x=1`, {
      method: 'POST',
      headers: { cookie: 'a=b', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'csrfToken=abc',
    });
    const rebased = rebaseRequestOntoHost(req, { hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' });
    expect(new URL(rebased.url).origin).toBe('https://helpdesk.pbnj.ca');
    expect(new URL(rebased.url).pathname + new URL(rebased.url).search).toBe('/api/auth/callback/credentials?x=1');
    expect(rebased.method).toBe('POST');
    expect(rebased.headers.get('cookie')).toBe('a=b');
    expect(await rebased.text()).toBe('csrfToken=abc');
  });
});

describe('resolveCustomAuthHost', () => {
  const lookup = vi.fn();
  beforeEach(() => {
    clearCustomAuthHostCache();
    lookup.mockReset();
    vi.stubEnv('NEXTAUTH_URL', CANONICAL);
  });
  afterEach(() => vi.unstubAllEnvs());

  const req = (host: string, extra: Record<string, string> = {}) =>
    new Request(`${CANONICAL}/api/auth/session`, { headers: { host, ...extra } });

  it('returns null on the canonical host without querying', async () => {
    expect(await resolveCustomAuthHost(req('algapsa.com'), { lookupSurface: lookup })).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns the host for an active msp or both domain', async () => {
    lookup.mockResolvedValueOnce({ surface: 'msp', tenant: 'tenant-a' });
    expect(await resolveCustomAuthHost(req('helpdesk.pbnj.ca'), { lookupSurface: lookup }))
      .toEqual({ hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' });
    clearCustomAuthHostCache();
    lookup.mockResolvedValueOnce({ surface: 'both', tenant: 'tenant-a' });
    expect(await resolveCustomAuthHost(req('helpdesk.pbnj.ca'), { lookupSurface: lookup })).not.toBeNull();
  });

  it('keeps client_portal-only and unknown hosts on the legacy canonical-origin path', async () => {
    lookup.mockResolvedValueOnce({ surface: 'client_portal', tenant: 'tenant-a' });
    expect(await resolveCustomAuthHost(req('portal.pbnj.ca'), { lookupSurface: lookup })).toBeNull();
    clearCustomAuthHostCache();
    lookup.mockResolvedValueOnce(null);
    expect(await resolveCustomAuthHost(req('evil.example.com'), { lookupSurface: lookup })).toBeNull();
    clearCustomAuthHostCache();
    lookup.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveCustomAuthHost(req('helpdesk.pbnj.ca'), { lookupSurface: lookup })).toBeNull();
  });

  it('does not trust X-Forwarded-Host unless the deployment opts in', async () => {
    lookup.mockResolvedValue({ surface: 'msp', tenant: 'tenant-a' });
    expect(await resolveCustomAuthHost(req('algapsa.com', { 'x-forwarded-host': 'helpdesk.pbnj.ca' }), { lookupSurface: lookup })).toBeNull();

    vi.stubEnv('TRUST_FORWARDED_HOST', 'true');
    clearCustomAuthHostCache();
    expect(await resolveCustomAuthHost(req('algapsa.com', { 'x-forwarded-host': 'helpdesk.pbnj.ca' }), { lookupSurface: lookup }))
      .toEqual({ hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' });
  });
});

describe('createCustomHostAwareHandler (real @auth/core over the rebased request)', () => {
  const defaultHandler = vi.fn(async () => new Response('default'));
  const make = (host: { hostHeader: string; proto: string; tenant: string } | null) =>
    createCustomHostAwareHandler({
      defaultHandler,
      resolveHost: async () => host,
      loadConfig: async () => baseConfig(),
      runAuth: Auth as any,
    });

  beforeEach(() => {
    defaultHandler.mockClear();
    vi.stubEnv('NEXTAUTH_URL', CANONICAL);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('delegates to next-auth untouched when the host is not a custom MSP host', async () => {
    const res = await make(null)(new Request(`${CANONICAL}/api/auth/providers`));
    expect(await res.text()).toBe('default');
    expect(defaultHandler).toHaveBeenCalledTimes(1);
  });

  it('credentials and SSO callback URLs resolve to the custom host', async () => {
    const res = await make({ hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' })(
      new Request(`${CANONICAL}/api/auth/providers`, { headers: { host: 'helpdesk.pbnj.ca' } })
    );
    expect(defaultHandler).not.toHaveBeenCalled();
    const providers = await res.json();
    expect(providers.credentials.callbackUrl).toBe('https://helpdesk.pbnj.ca/api/auth/callback/credentials');
    expect(providers.google.callbackUrl).toBe('https://helpdesk.pbnj.ca/api/auth/callback/google');
  });

  it('starts SSO with a redirect_uri on the custom host and host-scoped state cookies', async () => {
    const config = baseConfig();
    const handler = createCustomHostAwareHandler({
      defaultHandler,
      resolveHost: async () => ({ hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' }),
      loadConfig: async () => config,
      runAuth: Auth as any,
    });
    const csrf = await handler(new Request(`${CANONICAL}/api/auth/csrf`));
    const { csrfToken } = await csrf.json();
    const csrfCookie = (csrf.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

    const res = await handler(
      new Request(`${CANONICAL}/api/auth/signin/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
        body: new URLSearchParams({ csrfToken, callbackUrl: '/msp/dashboard' }),
      })
    );
    const location = res.headers.get('location') ?? '';
    expect(new URL(location).searchParams.get('redirect_uri')).toBe('https://helpdesk.pbnj.ca/api/auth/callback/google');
    const setCookies = res.headers.getSetCookie?.() ?? [];
    // Host-only cookies (no Domain attribute) so the session/state stick to the custom host.
    expect(setCookies.length).toBeGreaterThan(0);
    for (const cookie of setCookies) {
      expect(cookie.toLowerCase()).not.toContain('domain=');
    }
  });
});

describe('tenant binding on a custom host (D7: one host = one tenant)', () => {
  const HOST = { hostHeader: 'helpdesk.pbnj.ca', proto: 'https', tenant: 'tenant-a' };
  const users: Record<string, { id: string; email: string; tenant: string; user_type: string }> = {
    'tech-a@example.com': { id: 'u-a', email: 'tech-a@example.com', tenant: 'tenant-a', user_type: 'internal' },
    'tech-b@example.com': { id: 'u-b', email: 'tech-b@example.com', tenant: 'tenant-b', user_type: 'internal' },
  };

  // Both technicians have VALID credentials; only the host's tenant may sign in.
  const config = () => ({
    secret: 'unit-test-secret',
    basePath: '/api/auth',
    session: { strategy: 'jwt' as const },
    providers: [
      Credentials({
        credentials: { email: {}, password: {} },
        authorize: async (c: any) => (c?.password === 'correct' ? users[String(c.email)] ?? null : null),
      }),
    ],
    callbacks: {
      signIn: async () => true,
      jwt: async ({ token, user }: any) => (user ? { ...token, tenant: user.tenant, id: user.id } : token),
      session: async ({ session, token }: any) => ({ ...session, user: { id: token.id, tenant: token.tenant } }),
    },
  });

  const handler = (cfg: any = config()) =>
    createCustomHostAwareHandler({
      defaultHandler: vi.fn(async () => new Response('default')),
      resolveHost: async () => HOST,
      loadConfig: async () => cfg,
      runAuth: Auth as any,
    });

  beforeEach(() => vi.stubEnv('NEXTAUTH_URL', CANONICAL));
  afterEach(() => vi.unstubAllEnvs());

  async function signInWithCredentials(email: string) {
    const h = handler();
    const csrf = await h(new Request(`${CANONICAL}/api/auth/csrf`));
    const { csrfToken } = await csrf.json();
    const cookie = (csrf.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    return h(
      new Request(`${CANONICAL}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ csrfToken, email, password: 'correct', callbackUrl: '/msp/dashboard' }),
      })
    );
  }

  const sessionCookies = (res: Response) =>
    (res.headers.getSetCookie?.() ?? []).filter((c) => /session-token/.test(c));

  it('refuses a technician of another tenant: no session cookie, ordinary CredentialsSignin', async () => {
    const res = await signInWithCredentials('tech-b@example.com');
    expect(sessionCookies(res)).toHaveLength(0);
    const location = res.headers.get('location') ?? '';
    expect(new URL(location).searchParams.get('error')).toBe('CredentialsSignin');
    expect(location).not.toMatch(/tenant-b|tech-b/);
  });

  it('lets a technician of the owning tenant sign in', async () => {
    const res = await signInWithCredentials('tech-a@example.com');
    expect(sessionCookies(res).length).toBeGreaterThan(0);
    expect(res.headers.get('location') ?? '').not.toContain('error=');
  });

  it('refuses an SSO signIn callback for a foreign tenant (before and after the original callback)', async () => {
    const original = vi.fn(async () => true);
    const bound: any = bindAuthConfigToTenant({ ...config(), callbacks: { signIn: original } }, 'tenant-a');
    const oauth = { provider: 'google' };
    expect(await bound.callbacks.signIn({ user: users['tech-b@example.com'], account: oauth })).toBe(false);
    expect(original).not.toHaveBeenCalled();
    // tenant only resolved inside the original callback (OAuth account hints)
    const lateTenant = { id: 'x', email: 'x@example.com' } as any;
    const late: any = bindAuthConfigToTenant(
      { callbacks: { signIn: async ({ user }: any) => { user.tenant = 'tenant-b'; return true; } } },
      'tenant-a'
    );
    expect(await late.callbacks.signIn({ user: lateTenant, account: oauth })).toBe(false);
    expect(await bound.callbacks.signIn({ user: users['tech-a@example.com'], account: oauth })).toBe(true);
  });

  it('presents a foreign-tenant session token as signed out', async () => {
    const bound: any = bindAuthConfigToTenant(config(), 'tenant-a');
    expect(await bound.callbacks.session({ session: {}, token: { tenant: 'tenant-b', id: 'u-b' } })).toEqual({ expires: '0' });
    expect((await bound.callbacks.session({ session: {}, token: { tenant: 'tenant-a', id: 'u-a' } })).user.id).toBe('u-a');
  });
});
