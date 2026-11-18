import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@auth/core/jwt';

// The Express-side issuer, the edge middleware and Auth.js itself must name the
// session cookie identically: the name is also the JWT salt, so a mismatch
// means signed-out loops (middleware) and undecryptable portal tokens.
const envSnapshot = { ...process.env };

const ENVIRONMENTS: Array<{
  label: string;
  env: Record<string, string | undefined>;
  expected: string;
}> = [
  {
    label: 'development with an explicit port',
    env: { NODE_ENV: 'development', NEXTAUTH_URL: 'http://localhost:3003', PORT: undefined },
    expected: 'authjs-port-3003.session-token',
  },
  {
    label: 'production over http with an explicit port',
    env: { NODE_ENV: 'production', NEXTAUTH_URL: 'http://psa.local:8080', PORT: '3000' },
    expected: 'authjs-port-8080.session-token',
  },
  {
    label: 'production over http without a port',
    env: { NODE_ENV: 'production', NEXTAUTH_URL: 'http://psa.local', PORT: '3000' },
    expected: 'authjs.session-token',
  },
  {
    label: 'production over https with an explicit port',
    env: { NODE_ENV: 'production', NEXTAUTH_URL: 'https://psa.example.com:8443', PORT: '3000' },
    expected: '__Secure-authjs-port-8443.session-token',
  },
  {
    label: 'production over https without a port',
    env: { NODE_ENV: 'production', NEXTAUTH_URL: 'https://psa.example.com', PORT: '3000' },
    expected: '__Secure-authjs.session-token',
  },
];

function applyEnv(env: Record<string, string | undefined>) {
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.APP_PORT;
  delete process.env.EXPOSE_SERVER_PORT;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as any)[key];
    else (process.env as any)[key] = value;
  }
}

describe('server session cookie name', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.NEXTAUTH_SESSION_EXPIRES = '3600';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
  });

  describe.each(ENVIRONMENTS)('$label', ({ env, expected }) => {
    it('is one string across the server module, its config, the package and the token salt', async () => {
      applyEnv(env);
      const server = await import('./sessionCookies');
      const pkg = await import('@alga-psa/auth/session');

      expect(server.getSessionCookieName()).toBe(expected);
      expect(server.getSessionCookieConfig().name).toBe(expected);
      expect(pkg.getSessionCookieName()).toBe(expected);
      expect(pkg.getSessionCookieConfig().name).toBe(expected);
      expect(server.getSessionCookieConfig().options).toEqual(pkg.getSessionCookieConfig().options);
    });

    it('issues a portal token that Auth.js decodes under the package cookie name', async () => {
      applyEnv(env);
      const { encodePortalSessionToken } = await import('./sessionCookies');
      const pkg = await import('@alga-psa/auth/session');

      const token = await encodePortalSessionToken({
        id: 'user-1',
        user_type: 'client',
        tenant: 'tenant-1',
      });

      const decoded = await decode({
        token,
        secret: 'test-secret',
        salt: pkg.getSessionCookieName(),
      });
      expect(decoded?.sub).toBe('user-1');
      expect(decoded?.tenant).toBe('tenant-1');
    });
  });

  it('does not add the __Secure- prefix to a production http deployment', async () => {
    applyEnv({ NODE_ENV: 'production', NEXTAUTH_URL: 'http://psa.local' });
    const { getSessionCookieConfig } = await import('./sessionCookies');
    expect(getSessionCookieConfig().name).not.toContain('__Secure-');
    expect(getSessionCookieConfig().options.secure).toBe(false);
  });
});
