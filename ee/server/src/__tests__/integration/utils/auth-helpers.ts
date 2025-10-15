import type { Page } from '@playwright/test';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

function getSessionMaxAgeSeconds(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_SESSION_MAX_AGE_SECONDS : parsed;
}

export async function establishTenantSession(page: Page, tenantData: TenantTestData, baseUrl: string): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for Playwright auth mocking.');
  }

  const { encode } = await import('@auth/core/jwt');
  const cookieName = getSessionCookieName();
  const isHttps = baseUrl.startsWith('https://');
  const sessionUser = {
    id: tenantData.adminUser.userId,
    email: tenantData.adminUser.email.toLowerCase(),
    name: `${tenantData.adminUser.firstName} ${tenantData.adminUser.lastName}`.trim() || tenantData.adminUser.email,
    username: tenantData.adminUser.email.toLowerCase(),
    proToken: 'playwright-mock-token',
    tenant: tenantData.tenant.tenantId,
    user_type: 'internal',
  };

  const maxAge = getSessionMaxAgeSeconds();

  const token = await encode({
    token: {
      ...sessionUser,
      sub: sessionUser.id,
    },
    secret,
    maxAge,
    salt: cookieName,
  });

  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + maxAge;

  const context = page.context();
  const allCookieNames = [
    cookieName,
    'authjs.session-token',
    'next-auth.session-token',
    ...(isHttps ? ['__Secure-authjs.session-token', '__Secure-next-auth.session-token'] : []),
  ];

  const cookieHosts = new Set<string>([
    baseUrl,
    'http://localhost:3000',
    'http://canonical.localhost:3000',
  ]);

  const cookiesByUrl: any[] = [];
  const cookiesByDomain: any[] = [];

  for (const url of cookieHosts) {
    for (const name of allCookieNames) {
      cookiesByUrl.push({
        name,
        value: token,
        url,
        httpOnly: true,
        secure: isHttps,
        sameSite: 'Lax',
        expires: expiresAtSeconds,
      });
    }
  }

  for (const domain of ['localhost', 'canonical.localhost']) {
    for (const name of allCookieNames) {
      cookiesByDomain.push({
        name,
        value: token,
        domain,
        path: '/',
        httpOnly: true,
        secure: isHttps,
        sameSite: 'Lax',
        expires: expiresAtSeconds,
      });
    }
  }

  await context.addCookies([...cookiesByUrl, ...cookiesByDomain]);
}
