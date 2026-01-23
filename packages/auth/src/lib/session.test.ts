import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@auth/core/jwt';
import {
  getSessionMaxAge,
  getSessionCookieName,
  getSessionCookieConfig,
  encodePortalSessionToken,
} from './session';

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
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

  it('suffixes cookie name with dev port when not in production', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://localhost:3001';
    expect(getSessionCookieName()).toBe('authjs.session-token.3001');
  });

  it('uses secure cookie name in production without port suffix', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    expect(getSessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  it('returns cookie config aligned with environment', () => {
    process.env.NODE_ENV = 'production';
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
