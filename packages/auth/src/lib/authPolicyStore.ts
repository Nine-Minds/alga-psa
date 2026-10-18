import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import logger from '@alga-psa/core/logger';
import {
  DEFAULT_TENANT_AUTH_POLICY,
  normalizeTenantAuthPolicy,
  type BreakGlassCandidate,
  type LoginRefusalReason,
  type PasswordAuthSurface,
  type TenantAuthPolicy,
} from './authPolicy';

/**
 * I/O side of the tenant login policy (see authPolicy.ts for the decisions).
 *
 * EE/CE seam: the policy lives in the tenant `settings.sso` JSON that the EE
 * Security settings write, but it is read here directly from `tenant_settings`,
 * so packages/auth needs no EE import. On CE (or any tenant that never saved a
 * policy) there are no policy fields, `loadTenantAuthPolicy` returns the all-off
 * default, and login behaves exactly as before.
 *
 * Server-only: never import from a client component.
 */

const POLICY_CACHE_TTL_MS = 15_000;
const policyCache = new Map<string, { policy: TenantAuthPolicy; expiresAt: number }>();

function parseSettings(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

/**
 * Load a tenant's login policy. Throws if the settings row cannot be read: callers
 * that gate a sign-in must fail closed rather than assume "no policy".
 *
 * Cached briefly per process because the JWT callback consults it on every
 * request; `invalidateTenantAuthPolicyCache` is called on save so the saving
 * replica sees the change immediately (other replicas converge within the TTL).
 */
export async function loadTenantAuthPolicy(
  tenant: string,
  options: { bypassCache?: boolean } = {},
): Promise<TenantAuthPolicy> {
  if (!tenant) {
    return { ...DEFAULT_TENANT_AUTH_POLICY, passwordBreakGlassUserIds: [] };
  }
  const cached = policyCache.get(tenant);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }
  const knex = await getAdminConnection();
  const row = await tenantDb(knex, tenant).table('tenant_settings').select('settings').first();
  const policy = normalizeTenantAuthPolicy(parseSettings(row?.settings));
  policyCache.set(tenant, { policy, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
  return policy;
}

export function invalidateTenantAuthPolicyCache(tenant?: string): void {
  if (tenant) {
    policyCache.delete(tenant);
  } else {
    policyCache.clear();
  }
}

/** Candidate data for the save-time guard and the break-glass picker: internal users with admin-role and 2FA state. */
export async function listBreakGlassCandidates(
  tenant: string,
  userIds?: string[],
): Promise<BreakGlassCandidate[]> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenant);
  const query = db
    .table('users')
    .where('users.user_type', 'internal')
    .select('users.user_id', 'users.user_type', 'users.is_inactive', 'users.two_factor_enabled');
  if (userIds) {
    if (userIds.length === 0) return [];
    query.whereIn('users.user_id', userIds);
  }
  const users = (await query) as Array<{
    user_id: string;
    user_type: string;
    is_inactive: boolean | null;
    two_factor_enabled: boolean | null;
  }>;
  if (users.length === 0) return [];

  const adminQuery = db
    .table('user_roles')
    .whereRaw('LOWER(roles.role_name) = ?', ['admin'])
    .whereIn('user_roles.user_id', users.map((u) => u.user_id))
    .distinct('user_roles.user_id');
  db.tenantJoin(adminQuery, 'roles', 'roles.role_id', 'user_roles.role_id');
  const adminRows = (await adminQuery) as Array<{ user_id: string }>;
  const adminIds = new Set(adminRows.map((r) => r.user_id));

  return users.map((u) => ({
    userId: u.user_id,
    userType: u.user_type,
    isInactive: Boolean(u.is_inactive),
    isAdmin: adminIds.has(u.user_id),
    twoFactorEnabled: Boolean(u.two_factor_enabled),
  }));
}

async function writeAudit(
  tenant: string,
  entry: {
    operation: string;
    recordId: string;
    userId?: string | null;
    changedData?: Record<string, unknown>;
    details: Record<string, unknown>;
  },
): Promise<void> {
  const knex = await getAdminConnection();
  await tenantDb(knex, tenant).table('audit_logs').insert({
    audit_id: knex.raw('gen_random_uuid()'),
    tenant,
    table_name: 'tenant_settings',
    operation: entry.operation,
    record_id: entry.recordId,
    user_id: entry.userId ?? null,
    changed_data: JSON.stringify(entry.changedData ?? {}),
    details: JSON.stringify(entry.details),
    timestamp: knex.fn.now(),
  });
}

/**
 * Audit a refused login. Best effort: an audit failure must never turn a refusal
 * into an allow, so errors are logged and swallowed. Never pass secrets here.
 */
export async function recordLoginRefusal(params: {
  tenant: string;
  userId: string;
  userType: string;
  reason: LoginRefusalReason;
  surface: PasswordAuthSurface;
}): Promise<void> {
  try {
    await writeAudit(params.tenant, {
      operation: 'LOGIN_POLICY_REFUSED',
      recordId: params.userId,
      userId: params.userId,
      details: {
        reason: params.reason,
        surface: params.surface,
        user_type: params.userType,
        tenant: params.tenant,
      },
    });
  } catch (error) {
    logger.warn('[authPolicy] Failed to write login refusal audit entry', {
      tenant: params.tenant,
      reason: params.reason,
      surface: params.surface,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Audit a policy change with the before/after values. Throws: a change that cannot be audited should not be saved silently. */
export async function recordPolicyChange(params: {
  tenant: string;
  actorUserId: string;
  before: TenantAuthPolicy;
  after: TenantAuthPolicy;
}): Promise<void> {
  await writeAudit(params.tenant, {
    operation: 'LOGIN_POLICY_CHANGED',
    recordId: params.tenant,
    userId: params.actorUserId,
    changedData: { before: params.before, after: params.after },
    details: { operation: 'login_policy_changed', changed_by: params.actorUserId },
  });
}

/** Audit a forced 2FA enrollment completed at sign-in. The secret is never logged. */
export async function recordForcedTwoFactorEnrollment(params: {
  tenant: string;
  userId: string;
  surface: PasswordAuthSurface;
}): Promise<void> {
  try {
    await writeAudit(params.tenant, {
      operation: 'TWO_FACTOR_ENROLLED_BY_POLICY',
      recordId: params.userId,
      userId: params.userId,
      details: { surface: params.surface, tenant: params.tenant },
    });
  } catch (error) {
    logger.warn('[authPolicy] Failed to write forced enrollment audit entry', {
      tenant: params.tenant,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
