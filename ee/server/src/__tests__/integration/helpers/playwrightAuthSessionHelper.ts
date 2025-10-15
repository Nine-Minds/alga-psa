import type { Page } from '@playwright/test';
import type { TenantTestData } from '../../../lib/testing/tenant-test-factory';

export interface SessionUserClaims {
  id: string;
  email: string;
  name: string;
  username: string;
  tenant: string;
  user_type: string;
  proToken?: string;
  [key: string]: unknown;
}

export type AuthSessionOptions = {
  baseUrl?: string;
  sessionMaxAgeSeconds?: number;
  sessionClaims?: Partial<SessionUserClaims>;
  additionalCookieNames?: string[];
  additionalHosts?: string[];
  additionalDomains?: string[];
};

/**
 * Central helper for establishing an authenticated Playwright session that mirrors NextAuth's
 * cookie handshake. Ensures a consistent session token across tests and centralises host/domain
 * variants that our app relies on (localhost vs canonical.localhost, secure vs insecure cookies).
 */
export class PlaywrightAuthSessionHelper {
  private static readonly DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
  private readonly page: Page;
  private readonly tenantData: TenantTestData;
  private readonly options: AuthSessionOptions;

  private constructor(page: Page, tenantData: TenantTestData, options: AuthSessionOptions) {
    this.page = page;
    this.tenantData = tenantData;
    this.options = options;
  }

  static async authenticate(
    page: Page,
    tenantData: TenantTestData,
    options: AuthSessionOptions = {}
  ): Promise<void> {
    const helper = new PlaywrightAuthSessionHelper(page, tenantData, options);
    await helper.applyAuthenticatedSession();
  }

  private get baseUrl(): string {
    return (
      this.options.baseUrl ??
      process.env.EE_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      'http://localhost:3000'
    );
  }

  private get isHttps(): boolean {
    return this.baseUrl.startsWith('https://');
  }

  private get primaryCookieName(): string {
    return process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  }

  private get cookieNames(): string[] {
    const cookieNames = new Set<string>([
      this.primaryCookieName,
      'authjs.session-token',
      'next-auth.session-token',
      ...(this.options.additionalCookieNames ?? []),
    ]);

    if (this.isHttps) {
      cookieNames.add('__Secure-authjs.session-token');
      cookieNames.add('__Secure-next-auth.session-token');
    }

    return Array.from(cookieNames);
  }

  private get cookieHosts(): string[] {
    const hosts = new Set<string>([
      this.baseUrl,
      'http://localhost:3000',
      'http://canonical.localhost:3000',
      ...(this.options.additionalHosts ?? []),
    ]);

    return Array.from(hosts).filter(Boolean);
  }

  private get cookieDomains(): string[] {
    const domains = new Set<string>([
      'localhost',
      'canonical.localhost',
      ...(this.options.additionalDomains ?? []),
    ]);
    return Array.from(domains).filter(Boolean);
  }

  private get sessionMaxAgeSeconds(): number {
    if (typeof this.options.sessionMaxAgeSeconds === 'number') {
      return this.options.sessionMaxAgeSeconds;
    }

    const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
    if (!raw) {
      return PlaywrightAuthSessionHelper.DEFAULT_SESSION_MAX_AGE_SECONDS;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed)
      ? PlaywrightAuthSessionHelper.DEFAULT_SESSION_MAX_AGE_SECONDS
      : parsed;
  }

  private buildSessionClaims(): SessionUserClaims {
    const { adminUser, tenant } = this.tenantData;
    const defaultClaims: SessionUserClaims = {
      id: adminUser.userId,
      email: adminUser.email.toLowerCase(),
      name:
        `${adminUser.firstName} ${adminUser.lastName}`.trim() || adminUser.email,
      username: adminUser.email.toLowerCase(),
      tenant: tenant.tenantId,
      user_type: 'internal',
      proToken: 'playwright-mock-token',
    };

    return {
      ...defaultClaims,
      ...(this.options.sessionClaims ?? {}),
    };
  }

  private async applyAuthenticatedSession(): Promise<void> {
    const secret = process.env.NEXTAUTH_SECRET;

    if (!secret) {
      throw new Error('NEXTAUTH_SECRET must be defined for Playwright auth mocking.');
    }

    const { encode } = await import('@auth/core/jwt');

    const sessionClaims = this.buildSessionClaims();
    const maxAgeSeconds = this.sessionMaxAgeSeconds;

    const token = await encode({
      token: {
        ...sessionClaims,
        sub: sessionClaims.id,
      },
      secret,
      maxAge: maxAgeSeconds,
      salt: this.primaryCookieName,
    });

    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + maxAgeSeconds;

    const context = this.page.context();
    const cookies: Parameters<typeof context.addCookies>[0] = [];

    for (const url of this.cookieHosts) {
      for (const name of this.cookieNames) {
        cookies.push({
          name,
          value: token,
          url,
          httpOnly: true,
          secure: this.isHttps,
          sameSite: 'Lax',
          expires: expiresAtSeconds,
        });
      }
    }

    for (const domain of this.cookieDomains) {
      for (const name of this.cookieNames) {
        cookies.push({
          name,
          value: token,
          domain,
          path: '/',
          httpOnly: true,
          secure: this.isHttps,
          sameSite: 'Lax',
          expires: expiresAtSeconds,
        });
      }
    }

    await context.addCookies(cookies);

    console.log('[Playwright Auth] Valid session JWT cookie set');
  }
}

export async function setupAuthenticatedSession(
  page: Page,
  tenantData: TenantTestData,
  options: AuthSessionOptions = {}
): Promise<void> {
  await PlaywrightAuthSessionHelper.authenticate(page, tenantData, options);
}
