import type { Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestTenant,
  type TenantTestData,
  type TenantTestOptions,
} from '../../../lib/testing/tenant-test-factory';

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

export type TenantPermissionTuple = {
  resource: string;
  action: string;
};

export type TenantRolePermissionConfig = {
  roleName: string;
  permissions: TenantPermissionTuple[];
};

export type TenantPreparationOptions = {
  completeOnboarding?: boolean | { completedAt?: Date };
  permissions?: TenantRolePermissionConfig[];
};

export type CreateTenantAndLoginOptions = TenantPreparationOptions & {
  tenantOptions?: TenantTestOptions;
  sessionOptions?: AuthSessionOptions;
};

export function applyPlaywrightAuthEnvDefaults(): void {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  process.env.E2E_AUTH_BYPASS = process.env.E2E_AUTH_BYPASS || 'true';
}

export function resolvePlaywrightBaseUrl(): string {
  const candidate =
    process.env.EE_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.PLAYWRIGHT_BASE_URL;

  if (candidate && candidate !== 'undefined' && candidate !== 'null') {
    return candidate;
  }

  const host = process.env.PLAYWRIGHT_APP_HOST || 'localhost';
  const port =
    process.env.PLAYWRIGHT_APP_PORT ||
    process.env.APP_PORT ||
    process.env.PORT;

  if (port && port !== 'undefined' && port !== 'null') {
    return `http://${host}:${port}`;
  }

  return 'http://localhost:3000';
}

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

  private get devCookiePortSuffix(): string | null {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }

    // Match server/src/lib/auth/sessionCookies#getDevCookiePortSuffix behavior:
    // prefer NEXTAUTH_URL (and friends), then fall back to PORT/APP_PORT.
    const urlCandidates = [
      process.env.NEXTAUTH_URL,
      process.env.APP_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      this.baseUrl,
    ].filter(Boolean) as string[];

    for (const candidate of urlCandidates) {
      try {
        const parsed = new URL(candidate);
        if (parsed.port) {
          return parsed.port;
        }
      } catch {
        // Ignore invalid URLs and fall through to other candidates.
      }
    }

    const portCandidate =
      process.env.PORT ?? process.env.APP_PORT ?? process.env.EXPOSE_SERVER_PORT ?? null;
    return portCandidate && portCandidate.length > 0 ? portCandidate : null;
  }

  private get primaryCookieName(): string {
    const baseName = process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';

    const portSuffix = this.devCookiePortSuffix;
    if (!portSuffix) {
      return baseName;
    }

    return `${baseName}.${portSuffix}`;
  }

  private get cookieNames(): string[] {
    const cookieNames = new Set<string>([
      this.primaryCookieName,
      // Back-compat / additional lookups (some parts of the app/tests still check these)
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

    const context = this.page.context();
    const cookies: Array<Parameters<typeof context.addCookies>[0][number]> = [];

    // Playwright is strict about cookie shapes; prefer a minimal set of URL-scoped cookies
    // to avoid invalid domain/secure combinations when running on non-standard hosts/ports.
    const parsedBaseUrl = new URL(this.baseUrl);
    parsedBaseUrl.pathname = '/';
    parsedBaseUrl.search = '';
    parsedBaseUrl.hash = '';
    const cookieUrl = parsedBaseUrl.toString();

    for (const name of this.cookieNames) {
      cookies.push({
        name,
        value: token,
        url: cookieUrl,
      });
    }

    try {
      await context.addCookies(cookies);
    } catch (error) {
      console.error('[Playwright Auth] Failed to set cookies', {
        baseUrl: this.baseUrl,
        cookieUrl,
        cookieCount: cookies.length,
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          valueType: typeof cookie.value,
          valueLength: typeof cookie.value === 'string' ? cookie.value.length : null,
          url: 'url' in cookie ? (cookie as any).url : undefined,
          domain: 'domain' in cookie ? (cookie as any).domain : undefined,
          path: 'path' in cookie ? (cookie as any).path : undefined,
          expires: 'expires' in cookie ? (cookie as any).expires : undefined,
          httpOnly: 'httpOnly' in cookie ? (cookie as any).httpOnly : undefined,
          secure: 'secure' in cookie ? (cookie as any).secure : undefined,
          sameSite: 'sameSite' in cookie ? (cookie as any).sameSite : undefined,
        })),
      });
      throw error;
    }

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

export async function ensureRoleHasPermission(
  db: Knex,
  tenantId: string,
  roleName: string,
  permissionTuples: TenantPermissionTuple[]
): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: roleName })
    .first();

  if (!role) {
    throw new Error(`Role ${roleName} not found for tenant ${tenantId}`);
  }

  for (const { resource, action } of permissionTuples) {
    let permission = await db('permissions')
      .where({ tenant: tenantId, resource, action })
      .first();

    if (!permission) {
      permission = {
        permission_id: uuidv4(),
        tenant: tenantId,
        resource,
        action,
        msp: true,
        client: false,
        created_at: new Date(),
      };
      await db('permissions').insert(permission);
    } else if (!permission.msp) {
      await db('permissions')
        .where({ permission_id: permission.permission_id })
        .update({ msp: true });
    }

    const existingLink = await db('role_permissions')
      .where({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      })
      .first();

    if (!existingLink) {
      await db('role_permissions').insert({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      });
    }
  }
}

export async function markOnboardingComplete(
  db: Knex,
  tenantId: string,
  completedAt: Date = new Date()
): Promise<void> {
  await db('tenant_settings')
    .insert({
      tenant: tenantId,
      onboarding_completed: true,
      onboarding_completed_at: completedAt,
      onboarding_skipped: false,
      onboarding_data: null,
      settings: {},
      created_at: completedAt,
      updated_at: completedAt,
    })
    .onConflict('tenant')
    .merge({
      onboarding_completed: true,
      onboarding_completed_at: completedAt,
      onboarding_skipped: false,
      updated_at: completedAt,
    });
}

export async function prepareTenantForPlaywright(
  db: Knex,
  tenantId: string,
  options: TenantPreparationOptions = {}
): Promise<void> {
  const { completeOnboarding, permissions } = options;

  if (completeOnboarding) {
    const completedAt =
      typeof completeOnboarding === 'object' && completeOnboarding.completedAt
        ? completeOnboarding.completedAt
        : new Date();
    await markOnboardingComplete(db, tenantId, completedAt);
  }

  if (permissions) {
    for (const { roleName, permissions: tuples } of permissions) {
      await ensureRoleHasPermission(db, tenantId, roleName, tuples);
    }
  }
}

export async function createTenantAndLogin(
  db: Knex,
  page: Page,
  options: CreateTenantAndLoginOptions = {}
): Promise<TenantTestData> {
  const { tenantOptions, sessionOptions, ...preparationOptions } = options;

  const tenantData = await createTestTenant(db, tenantOptions);
  await prepareTenantForPlaywright(db, tenantData.tenant.tenantId, preparationOptions);
  await setupAuthenticatedSession(page, tenantData, sessionOptions);

  return tenantData;
}
