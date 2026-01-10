import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const encodeMock = vi.fn();

vi.mock('@auth/core/jwt', () => ({
  encode: encodeMock,
}));

const originalSecret = process.env.NEXTAUTH_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

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

    if (originalNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  it('passes the authjs cookie name as the salt in development', async () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://localhost:3003';
    const { encodePortalSessionToken } = await import('./sessionCookies');

    await encodePortalSessionToken({
      id: 'user-1',
      user_type: 'client',
      tenant: 'tenant-1',
    });

    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        salt: 'authjs.session-token.3003',
      }),
    );
  });

  it('uses the secure cookie name as the salt in production', async () => {
    (process.env as any).NODE_ENV = 'production';
    const { encodePortalSessionToken } = await import('./sessionCookies');

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
  });
});
