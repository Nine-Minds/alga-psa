import { encode } from '@auth/core/jwt';
import type { Page } from '@playwright/test';
import { knex as createKnex, type Knex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './playwrightDatabaseConfig';

export function adminDb(): Knex {
  return createKnex({
    client: 'pg',
    connection: {
      host: PLAYWRIGHT_DB_CONFIG.host,
      port: PLAYWRIGHT_DB_CONFIG.port,
      database: PLAYWRIGHT_DB_CONFIG.database,
      user: PLAYWRIGHT_DB_CONFIG.adminUser,
      password: PLAYWRIGHT_DB_CONFIG.adminPassword,
    },
    pool: { min: 0, max: 5 },
  });
}

export async function getInternalUser(db: Knex, email?: string) {
  if (email) {
    const row = await db('users')
      .where({ email: email.toLowerCase(), user_type: 'internal' })
      .first();
    if (row) return row;
  }
  const internal = await db('users').where({ user_type: 'internal' }).first();
  if (!internal) throw new Error('No internal users found in Playwright database.');
  return internal;
}

export async function setInternalSessionCookie(
  page: Page,
  user: any,
  baseUrl: string
): Promise<{ warmupRequired: boolean; cookieName: string }> {
  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET must be defined to mint session cookie.');
  }

  const portSuffix = (() => {
    if (process.env.NODE_ENV === 'production') return null;
    try {
      const parsed = new URL(baseUrl);
      return parsed.port || null;
    } catch {
      return process.env.PORT ?? process.env.APP_PORT ?? process.env.EXPOSE_SERVER_PORT ?? null;
    }
  })();

  const cookieBaseName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const cookieName = portSuffix ? `${cookieBaseName}.${portSuffix}` : cookieBaseName;

  const token = await encode({
    token: {
      sub: user.user_id,
      id: user.user_id,
      email: user.email,
      tenant: user.tenant,
      user_type: 'internal',
    },
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 60 * 60,
    salt: cookieName,
  });

  const base = new URL(baseUrl);

  try {
    await page.context().addCookies([
      {
        name: cookieName,
        value: token,
        url: base.origin,
      },
    ]);
    return { warmupRequired: false, cookieName };
  } catch (error) {
    console.warn('[Playwright] Failed to set auth cookie via context, falling back to client script.', error);
    const cookieValue = `${cookieName}=${token}; path=/; SameSite=Lax`;
    await page.addInitScript((value: string) => {
      document.cookie = value;
    }, cookieValue);
    return { warmupRequired: true, cookieName };
  }
}
