import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@auth/core/jwt';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getSessionMaxAge,
  getSessionCookieName,
  getSessionCookieConfig,
  withDevPortSuffix,
  encodePortalSessionToken,
} from './session';

// SessionStore is internal to Auth.js (not in its export map); load it from the
// installed package so the test exercises the real chunk-reading rule.
const authCoreDir = path.dirname(createRequire(import.meta.url).resolve('@auth/core/jwt'));
const { SessionStore } = (await import(
  pathToFileURL(path.join(authCoreDir, 'lib/utils/cookie.js')).href
)) as { SessionStore: new (option: unknown, cookies: Record<string, string>, logger: unknown) => {
  clean(): Array<{ name: string }>;
  value: string;
} };

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

  it('scopes cookie names to the dev port with a marker before authjs', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://localhost:3001';
    expect(getSessionCookieName()).toBe('authjs-port-3001.session-token');
    expect(withDevPortSuffix('authjs.pkce.code_verifier')).toBe('authjs-port-3001.pkce.code_verifier');
    expect(withDevPortSuffix('authjs.nonce')).toBe('authjs-port-3001.nonce');
    expect(withDevPortSuffix('__Secure-authjs.session-token')).toBe('__Secure-authjs-port-3001.session-token');
    expect(withDevPortSuffix('other-cookie')).toBe('other-cookie-port-3001');
  });

  it('places the port marker after a __Host- prefix and before authjs', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com:8443';
    process.env.PORT = '3000';
    expect(withDevPortSuffix('__Host-authjs.csrf-token')).toBe('__Host-authjs-port-8443.csrf-token');
  });

  it('lets the public URL port beat the listener port', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com:8443';
    process.env.PORT = '3000';
    expect(getSessionCookieName()).toBe('__Secure-authjs-port-8443.session-token');

    process.env.NODE_ENV = 'development';
    expect(getSessionCookieName()).toBe('authjs-port-8443.session-token');
  });

  it('treats a port-less public URL as the default port even when the listener is PORT=3000', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    process.env.PORT = '3000';
    expect(getSessionCookieName()).toBe('__Secure-authjs.session-token');

    process.env.NODE_ENV = 'development';
    expect(getSessionCookieName()).toBe('authjs.session-token');
  });

  it('uses PORT only as a development fallback when no public URL is set', () => {
    delete process.env.NEXTAUTH_URL;
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.PORT = '3002';

    process.env.NODE_ENV = 'development';
    expect(getSessionCookieName()).toBe('authjs-port-3002.session-token');

    process.env.NODE_ENV = 'production';
    expect(getSessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  it('skips invalid public URLs and uses the next valid one', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'not a url';
    process.env.APP_URL = 'http://localhost:3010';
    expect(getSessionCookieName()).toBe('authjs-port-3010.session-token');
  });

  it('isolates the canonical dev and production review services by cookie name', () => {
    process.env.NEXTAUTH_URL = 'http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:3185';
    process.env.NODE_ENV = 'development';
    expect(getSessionCookieConfig().name).toBe('authjs-port-3185.session-token');

    process.env.NEXTAUTH_URL = 'http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185';
    process.env.NODE_ENV = 'production';
    expect(getSessionCookieConfig().name).toBe('authjs-port-23185.session-token');
    expect(getSessionCookieConfig().options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
  });

  it('keeps the secure name in production over https without a port marker', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    expect(getSessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  // Auth.js reads every cookie whose name starts with its session cookie name
  // as a token chunk and cleans them all when a token fails to decode. A
  // trailing `.<port>` looks like a chunk index to a runtime without the
  // port marker, so one runtime used to delete the other runtime's session.
  describe('cross-runtime chunk collision', () => {
    const runtimeWithoutPort = { name: 'authjs.session-token', options: { path: '/' } };

    it('counterfactual: a `.port`-suffixed name is cleared as a chunk', () => {
      const store = new SessionStore(
        runtimeWithoutPort,
        { 'authjs.session-token.3374': 'other-runtime-token' },
        { debug: () => undefined } as any,
      );
      expect(store.clean().map((cookie) => cookie.name)).toEqual(['authjs.session-token.3374']);
    });

    it('the repaired name is not read or cleared by another runtime', () => {
      process.env.NODE_ENV = 'development';
      process.env.NEXTAUTH_URL = 'http://localhost:3374';
      const repaired = getSessionCookieName();
      expect(repaired).toBe('authjs-port-3374.session-token');

      const store = new SessionStore(
        runtimeWithoutPort,
        { [repaired]: 'other-runtime-token' },
        { debug: () => undefined } as any,
      );
      expect(store.clean()).toEqual([]);
      expect(store.value).toBe('');
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
