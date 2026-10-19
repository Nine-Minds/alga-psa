import { getConnection, tenantDb } from '@alga-psa/db';
import { isInteractiveUserType, isLicensedUserType } from '@alga-psa/types';

/**
 * Provider-agnostic gate for anything that is about to start (or continue) a UI/mobile
 * session. It re-reads `users.user_type` and `is_inactive` from the database instead of
 * trusting what a provider profile or token claims, so it holds for credentials, Google,
 * Azure AD, Keycloak/OIDC and any future provider without naming a non-interactive type.
 *
 * Fails closed: a missing user, an inactive user, an unreadable row or a lookup error all
 * return false.
 */
async function readUserGate(
  userId: string,
  tenant: string,
): Promise<{ user_type: string | null; is_inactive: boolean | null } | null> {
  if (typeof userId !== 'string' || userId.length === 0 || typeof tenant !== 'string' || tenant.length === 0) {
    return null;
  }
  try {
    const knex = await getConnection(tenant);
    const row = await tenantDb(knex, tenant)
      .table('users')
      .where({ user_id: userId })
      .select('user_type', 'is_inactive')
      .first();
    return row ?? null;
  } catch (error) {
    console.error('[auth] interactive user lookup failed; failing closed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/** True when the user exists, is active and has an interactive type (internal | client). */
export async function assertInteractiveUser(userId: string, tenant: string): Promise<boolean> {
  const row = await readUserGate(userId, tenant);
  return Boolean(row) && !row!.is_inactive && isInteractiveUserType(row!.user_type);
}

/** True when the user exists, is active and is an internal (licensed MSP staff) user. Mobile paths. */
export async function assertActiveInternalUser(userId: string, tenant: string): Promise<boolean> {
  const row = await readUserGate(userId, tenant);
  return Boolean(row) && !row!.is_inactive && isLicensedUserType(row!.user_type);
}
