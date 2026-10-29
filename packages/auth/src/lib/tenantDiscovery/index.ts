import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getTenantSlugForTenant, tenantDb } from '@alga-psa/db';
import { normalizeLoginEmail } from '../security/loginEmail';
import { checkPasswordResetLimit } from '../security/rateLimiting';
import { isValidResolverCallbackUrl } from '../sso/mspSsoResolution';
import type { TenantDiscoveryProfile, TenantDiscoverySurface, TenantDiscoveryTemplateName } from './profiles';

export {
  CLIENT_TENANT_DISCOVERY_PROFILE,
  INTERNAL_TENANT_DISCOVERY_PROFILE,
} from './profiles';
export type { TenantDiscoveryProfile } from './profiles';

/**
 * Collaborators the engine needs but must not import: the base-URL resolver
 * lives in @alga-psa/tenancy and the mailer in @alga-psa/email, and both
 * depend on @alga-psa/auth. A layer above all three (server/) binds them.
 */
export interface TenantDiscoveryDeps {
  /** Origin the sign-in link for `tenant` should use on `surface` (vanity host or canonical). */
  resolveAppBase(
    tenant: string,
    surface: TenantDiscoverySurface,
    options: { knex: Knex },
  ): Promise<{ baseUrl?: string | null; source: 'vanity' | 'canonical' }>;
  /** Sends the recovery email listing one sign-in link per organization. */
  sendRecoveryEmail(
    email: string,
    tenantLoginInfos: TenantLoginInfo[],
    options: { templateName: TenantDiscoveryTemplateName },
  ): Promise<unknown>;
}

const TENANT_DISCOVERY_CONTEXT = 'tenant-recovery-discovery';

export const TENANT_DISCOVERY_GENERIC_MESSAGE =
  'If an account exists with that email, login links have been sent.';

export interface TenantDiscoveryResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TenantLoginInfo {
  tenantId: string;
  tenantName: string;
  loginUrl: string;
  source: 'vanity' | 'canonical';
}

/**
 * The only response the engine ever returns. Rate limited, precondition failed,
 * no users, sent and thrown error are indistinguishable to the caller.
 */
function genericResponse(): TenantDiscoveryResponse {
  return { success: true, message: TENANT_DISCOVERY_GENERIC_MESSAGE };
}

/** A callback survives only as a same-origin relative path. */
function sanitizeCallbackUrl(callbackUrl: string | undefined): string | undefined {
  const trimmed = callbackUrl?.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return undefined;
  }
  return isValidResolverCallbackUrl(trimmed) ? trimmed : undefined;
}

/**
 * Live users of the profile's type with this email, across tenants, one row per
 * tenant (duplicate rows inside a tenant must not mail the same link twice).
 */
async function findDiscoverableTenants(
  profile: TenantDiscoveryProfile,
  email: string,
): Promise<Array<{ tenant: string; client_name?: string | null }>> {
  const db = await getAdminConnection();
  const discoveryDb = tenantDb(db, TENANT_DISCOVERY_CONTEXT);
  const usersQuery = discoveryDb.unscoped<{ tenant: string }>(
    'users',
    'tenant discovery for sign-in recovery user email lookup',
  );
  discoveryDb.tenantJoin(usersQuery, 'tenants', 'users.tenant', 'tenants.tenant', { type: 'left' });

  const rows = (await usersQuery
    .where('users.email', email)
    .andWhere('users.user_type', profile.userType)
    .andWhere('users.is_inactive', false)
    .select('users.tenant', 'tenants.client_name')) as Array<{ tenant: string; client_name?: string | null }>;

  const byTenant = new Map<string, { tenant: string; client_name?: string | null }>();
  for (const row of rows) {
    if (!byTenant.has(row.tenant)) {
      byTenant.set(row.tenant, row);
    }
  }
  return [...byTenant.values()];
}

/**
 * Builds the sign-in link for one tenant: its vanity host when it has one that
 * serves the profile's surface, otherwise the canonical origin.
 */
export async function buildTenantSignInLink(
  profile: TenantDiscoveryProfile,
  deps: Pick<TenantDiscoveryDeps, 'resolveAppBase'>,
  tenantId: string,
  callbackUrl?: string,
): Promise<{ url: string; source: 'vanity' | 'canonical' }> {
  const db = await getAdminConnection();

  try {
    const tenantSlug = await getTenantSlugForTenant(tenantId);
    const resolved = await deps.resolveAppBase(tenantId, profile.surface, { knex: db });

    if (!resolved.baseUrl) {
      throw new Error('NEXTAUTH_URL (or NEXT_PUBLIC_BASE_URL) must be configured to compute canonical login links');
    }

    const url = new URL(profile.signInPath, `${resolved.baseUrl.replace(/\/+$/, '')}/`);
    if (resolved.source === 'canonical' || profile.vanityScopesTenant) {
      url.searchParams.set('tenant', tenantSlug);
    }
    if (callbackUrl) {
      url.searchParams.set('callbackUrl', callbackUrl);
    }
    return { url: url.toString(), source: resolved.source };
  } catch (error) {
    logger.error('[buildTenantSignInLink] Failed to build sign-in link', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

/**
 * Emails the mailbox owner one scoped sign-in link per organization where the
 * address has a live account of the profile's user type.
 *
 * Always resolves to the same generic response. Links are scoped sign-in URLs
 * carrying only a public slug, never login tokens.
 */
export async function requestTenantSignInLinks(
  profile: TenantDiscoveryProfile,
  deps: TenantDiscoveryDeps,
  email: string,
  callbackUrl?: string,
): Promise<TenantDiscoveryResponse> {
  try {
    const normalizedEmail = normalizeLoginEmail(email);
    if (!normalizedEmail) {
      return genericResponse();
    }

    // One budget per mailbox, shared with password reset: both send mail to this
    // address on an unauthenticated request, and the limit does not depend on
    // whether an account exists.
    const limit = await checkPasswordResetLimit(normalizedEmail);
    if (!limit.success) {
      logger.info('[requestTenantSignInLinks] Rate limited, not sending', { userType: profile.userType });
      return genericResponse();
    }

    if (profile.precondition && !(await profile.precondition(normalizedEmail))) {
      logger.info('[requestTenantSignInLinks] Precondition not met, not sending', { userType: profile.userType });
      return genericResponse();
    }

    const tenants = await findDiscoverableTenants(profile, normalizedEmail);
    if (tenants.length === 0) {
      logger.info('[requestTenantSignInLinks] No live users found, not sending', { userType: profile.userType });
      return genericResponse();
    }

    const safeCallbackUrl = sanitizeCallbackUrl(callbackUrl);
    const tenantLoginInfos: TenantLoginInfo[] = await Promise.all(
      tenants.map(async (row) => {
        const { url, source } = await buildTenantSignInLink(profile, deps, row.tenant, safeCallbackUrl);
        return {
          tenantId: row.tenant,
          tenantName: row.client_name || 'Unknown Organization',
          loginUrl: url,
          source,
        };
      }),
    );

    await deps.sendRecoveryEmail(normalizedEmail, tenantLoginInfos, {
      templateName: profile.templateName,
    });

    logger.info('[requestTenantSignInLinks] Recovery email sent', {
      userType: profile.userType,
      tenantCount: tenantLoginInfos.length,
    });
  } catch (error) {
    logger.error('[requestTenantSignInLinks] Error processing request:', error);
  }

  return genericResponse();
}
