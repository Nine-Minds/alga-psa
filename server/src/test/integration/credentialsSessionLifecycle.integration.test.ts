import { randomUUID } from 'node:crypto';
import { Auth } from '@auth/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';

// Exercises the real Auth.js credentials provider, password lookup, JWT callback,
// and PostgreSQL-backed durable session model without starting the application server.
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'security_credentials_session_lifecycle';
const { createTestDbConnection, wireLocalTestDbEnv } = await import('../../../test-utils/dbConfig');
const { createTenant, createUser } = await import('../../../test-utils/testDataFactory');

const password = 'Correct-Horse-9!';
const secret = `credentials-session-${randomUUID()}`;
const appOrigin = 'http://feature-security-secrets-in-getcurrentuser.localhost:3839';
let db: Knex;
let tenant: string;
let userId: string;
let email: string;
let authConfig: Record<string, any>;
let cookieName: string;
let originalSecret: string | undefined;
let originalUrl: string | undefined;

function makeCookieJarRequest() {
  const jar = new Map<string, string>();
  const request = async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await Auth(new Request(`${appOrigin}/api/auth/${path}`, { ...init, headers }), authConfig);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator >= 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  };
  return { jar, request };
}

describe('credentials sign-in with durable session enforcement', () => {
  beforeAll(async () => {
    originalSecret = process.env.NEXTAUTH_SECRET;
    originalUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_SECRET = secret;
    process.env.NEXTAUTH_URL = appOrigin;
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenant = await createTenant(db, 'Credentials session lifecycle');
    userId = await createUser(db, tenant, {
      email: `auth-${randomUUID()}@example.test`,
      user_type: 'internal',
      hashed_password: await hashPassword(password),
    });
    email = (await db('users').where({ tenant, user_id: userId }).first('email')).email;

    const { getAuthOptions } = await import('@alga-psa/auth/nextAuthOptions');
    authConfig = { ...await getAuthOptions(), trustHost: true, basePath: '/api/auth' };
    cookieName = authConfig.cookies.sessionToken.name;
  }, 180_000);

  afterAll(async () => {
    const { destroyAdminConnection } = await import('@alga-psa/db/admin');
    const { destroyTenantConnection } = await import('@alga-psa/db');
    await destroyTenantConnection().catch(() => undefined);
    await destroyAdminConnection().catch(() => undefined);
    if (db && tenant && userId) {
      await db('sessions').where({ tenant, user_id: userId }).del();
      await db('users').where({ tenant, user_id: userId }).del();
      await db('tenants').where({ tenant }).del();
    }
    await db?.destroy().catch(() => undefined);
    if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalUrl;
  });

  it('reauthenticates with an existing cookie when session-limit enforcement revokes that cookie’s row', async () => {
    const { UserSession } = await import('@alga-psa/db/models/UserSession');
    const { jar, request } = makeCookieJarRequest();
    const csrf = await request('csrf');
    const { csrfToken } = await csrf.json();
    const signIn = () => request('callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'session-lifecycle-test' },
      body: new URLSearchParams({
        csrfToken,
        callbackUrl: `${appOrigin}/`,
        email,
        password,
        userType: 'internal',
      }),
    });

    expect((await signIn()).status).toBe(302);
    expect(jar.get(cookieName)).toBeTruthy();
    const decodedFirst = await request('session');
    expect(decodedFirst.status).toBe(200);
    const firstSessionPayload = await decodedFirst.json();
    expect(firstSessionPayload.user).toMatchObject({ id: userId, tenant });
    const oldSessionId = firstSessionPayload.session_id as string;
    expect(oldSessionId).toBeTruthy();
    const oldSessionIdRow = await db('sessions').where({ tenant, session_id: oldSessionId }).first();
    expect(oldSessionIdRow).toBeTruthy();

    // Keep the cookie-backed session as the oldest active durable row. The
    // real sign-in authorization calls enforceMaxSessions before Auth.js
    // mints the next JWT.
    for (let index = 0; index < 4; index += 1) {
      await UserSession.create({
        tenant,
        user_id: userId,
        ip_address: '127.0.0.1',
        user_agent: `other-session-${index}`,
        device_fingerprint: `fingerprint-${index}`,
        device_name: `Test ${index}`,
        device_type: 'desktop',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        login_method: 'credentials',
      });
    }
    await db('sessions').where({ tenant, session_id: oldSessionId }).update({
      last_activity_at: new Date(Date.now() - 60_000),
    });

    expect((await signIn()).status).toBe(302);
    const oldRowAfterReauth = await UserSession.findById(tenant, oldSessionId);
    expect(oldRowAfterReauth?.revoked_reason).toBe('max_sessions');

    const decodedAfterReauth = await request('session');
    expect(decodedAfterReauth.status).toBe(200);
    const current = await decodedAfterReauth.json();
    expect(current.user).toMatchObject({ id: userId, tenant, user_type: 'internal' });
    expect(current.session_id).toBeTruthy();
    expect(current.session_id).not.toBe(oldRowAfterReauth?.session_id);
    await expect(UserSession.getRejectionReason(tenant, current.session_id, {
      userId,
      userType: 'internal',
    })).resolves.toBeNull();
    expect(await UserSession.getActiveSessionCount(tenant, userId)).toBe(5);
  });
});
