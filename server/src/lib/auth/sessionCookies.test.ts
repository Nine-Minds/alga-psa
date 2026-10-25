import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionCookieName as getPackageSessionCookieName } from '@alga-psa/auth/session';

const { encodeMock } = vi.hoisted(() => ({ encodeMock: vi.fn() }));

vi.mock('@auth/core/jwt', () => ({
  encode: encodeMock,
}));

const originalSecret = process.env.NEXTAUTH_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalPort = process.env.PORT;
const originalAppPort = process.env.APP_PORT;
const originalExposeServerPort = process.env.EXPOSE_SERVER_PORT;
const originalAppUrl = process.env.APP_URL;
const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

describe('encodePortalSessionToken', () => {
  beforeEach(() => {
    vi.resetModules();
    encodeMock.mockReset();
    encodeMock.mockResolvedValue('signed-token');
    process.env.NEXTAUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET;
    } else {
      process.env.NEXTAUTH_SECRET = originalSecret;
    }

    if (originalNodeEnv === undefined) {
      delete (process.env as any).NODE_ENV;
    } else {
      (process.env as any).NODE_ENV = originalNodeEnv;
    }

    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalAppPort === undefined) delete process.env.APP_PORT;
    else process.env.APP_PORT = originalAppPort;
    if (originalExposeServerPort === undefined) delete process.env.EXPOSE_SERVER_PORT;
    else process.env.EXPOSE_SERVER_PORT = originalExposeServerPort;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;
  });

  it('shares development cookie name and JWT salt with package auth consumers', async () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://localhost:3003';
    process.env.PORT = '3003';
    const { encodePortalSessionToken } = await import('./sessionCookies');

    await encodePortalSessionToken({
      id: 'user-1',
      user_type: 'client',
      tenant: 'tenant-1',
    });

    expect(getPackageSessionCookieName()).toBe('authjs-port-3003.session-token');
    const { getSessionCookieName } = await import('./sessionCookies');
    expect(getSessionCookieName()).toBe(getPackageSessionCookieName());
    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        salt: getPackageSessionCookieName(),
      }),
    );
  });

  it('uses the secure cookie name as the salt in production', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    process.env.PORT = '3000';
    const { encodePortalSessionToken, getSessionCookieName, getSessionCookieConfig } = await import('./sessionCookies');

    await encodePortalSessionToken({
      id: 'user-2',
      user_type: 'client',
      tenant: 'tenant-9',
    });

    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        salt: '__Secure-authjs.session-token',
      }),
    );
    expect(getSessionCookieName()).toBe(getPackageSessionCookieName());
    expect(getSessionCookieConfig().name).toBe(getPackageSessionCookieName());
    expect(getSessionCookieConfig().options.secure).toBe(true);
  });
});
