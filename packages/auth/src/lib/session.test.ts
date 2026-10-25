import { afterEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '@auth/core';
import { decode } from '@auth/core/jwt';
import {
  getSessionMaxAge,
  getSessionCookieName,
  getSessionCookieConfig,
  withDevPortSuffix,
  encodePortalSessionToken,
} from './session';

const envSnapshot = { ...process.env };

afterEach(() => {
  // Restore IN PLACE: modules that captured `process.env` by reference
  // (e.g. `import { env } from 'node:process'`) would keep reading the
  // old object if this reassigned process.env.
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

describe('session utilities', () => {
  it('uses default session max age when env is missing or invalid', () => {
    delete process.env.NEXTAUTH_SESSION_EXPIRES;
    expect(getSessionMaxAge()).toBe(60 * 60 * 24);

    process.env.NEXTAUTH_SESSION_EXPIRES = 'not-a-number';
    expect(getSessionMaxAge()).toBe(60 * 60 * 24);
  });

  it('uses configured session max age when provided', () => {
    process.env.NEXTAUTH_SESSION_EXPIRES = '7200';
    expect(getSessionMaxAge()).toBe(7200);
  });

  it('uses a non-chunking port marker for development auth cookies', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://localhost:3001';
    expect(getSessionCookieName()).toBe('authjs-port-3001.session-token');
    expect(withDevPortSuffix('authjs.pkce.code_verifier')).toBe('authjs-port-3001.pkce.code_verifier');
  });

  it('isolates production review runtimes on explicit ports', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'http://feature-co-managed-it.localhost:23377';
    expect(getSessionCookieName()).toBe('authjs-port-23377.session-token');
  });

  it('keeps the standard secure cookie name behind a port-forwarded production listener', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    process.env.PORT = '3000';
    process.env.APP_PORT = '3000';
    process.env.EXPOSE_SERVER_PORT = '3000';
    expect(getSessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  it('scopes production cookies by a nondefault public URL port, not its listener port', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com:8443';
    process.env.PORT = '3000';
    expect(getSessionCookieName()).toBe('__Secure-authjs-port-8443.session-token');
  });

  it('does not let a dev port cookie be parsed or cleared as a production token chunk', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://feature-co-managed-it.localhost:3374';
    const devCookie = getSessionCookieName();
    expect(devCookie).toBe('authjs-port-3374.session-token');

    const productionOptions = {
      basePath: '/api/auth',
      secret: 'cookie-port-test-secret',
      trustHost: true,
      session: { strategy: 'jwt' as const },
      providers: [],
      cookies: { sessionToken: { name: 'authjs.session-token', options: { path: '/' } } },
    };

    // Counterfactual: Auth.js reads `.3374` as a numeric session-cookie chunk,
    // rejects the dev token as a production token, and deletes the dev cookie.
    const beforeRepair = Auth(
      new Request('http://feature-co-managed-it.localhost:23377/api/auth/session', {
        headers: { cookie: 'authjs.session-token.3374=dev-session' },
      }),
      productionOptions,
    );

    return beforeRepair.then(async response => {
      expect(response.headers.get('set-cookie')).toContain('authjs.session-token.3374=; Max-Age=0');

      const afterRepair = await Auth(
        new Request('http://feature-co-managed-it.localhost:23377/api/auth/session', {
          headers: { cookie: `${devCookie}=dev-session` },
        }),
        productionOptions,
      );
      expect(afterRepair.headers.get('set-cookie')).not.toContain(`${devCookie}=; Max-Age=0`);
    });
  });

  it('returns cookie config aligned with environment', () => {
    process.env.NODE_ENV = 'production';
    // nx-invoked runs load the repo-root .env, which sets an http:// NEXTAUTH_URL;
    // pin it so isSecureCookieEnvironment() reflects this test's scenario.
    process.env.NEXTAUTH_URL = 'https://example.com';
    const config = getSessionCookieConfig();
    expect(config.options?.secure).toBe(true);
    expect(config.options?.httpOnly).toBe(true);
  });

  it('encodes portal session token with tenant and user metadata', async () => {
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_SESSION_EXPIRES = '3600';

    const token = await encodePortalSessionToken({
      id: 'user-1',
      tenant: 'tenant-1',
      email: 'user@example.com',
      user_type: 'internal',
    });

    expect(token).toBeTruthy();

    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET,
      salt: getSessionCookieName(),
    });

    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.tenant).toBe('tenant-1');
    expect(decoded?.email).toBe('user@example.com');
  });
});
