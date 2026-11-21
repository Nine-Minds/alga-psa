import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

/**
 * The two role floors every write path must respect:
 *
 *  1. A tenant always keeps at least one ACTIVE internal user holding the
 *     built-in MSP Admin role. Without it nobody can repair permissions and
 *     support has to restore the role by hand (ticket alga-2026-0003292).
 *  2. An interactive user always keeps at least one role. "Fewer permissions"
 *     is expressed by assigning a different role, never by an empty role set.
 *
 * Lives in @alga-psa/db because the vertical packages (users, auth,
 * client-portal) and the REST API services may not import one another, and the
 * decision must exist exactly once.
 */

export type UserRoleFloorChange =
  | { kind: 'remove_roles'; userId: string; roleIds: readonly string[] }
  | { kind: 'set_roles'; userId: string; roleIds: readonly string[] }
  | { kind: 'deactivate_user'; userId: string }
  | { kind: 'delete_user'; userId: string };

export type UserRoleFloorViolation = 'last_msp_admin' | 'last_role';

export type UserRoleFloorResult =
  | { ok: true }
  | { ok: false; violation: UserRoleFloorViolation; message: string };

export const LAST_MSP_ADMIN_MESSAGE = 'A tenant must keep at least one active MSP Admin user.';
export const LAST_ROLE_MESSAGE =
  'A user must keep at least one role. Assign another role first, then remove this one.';

/**
 * ee/server typechecks these sources with strictNullChecks off, where boolean
 * discriminant narrowing (`if (!result.ok)`) does not apply — a type-predicate
 * guard narrows under both modes. See reference_ee_server_strict_false_narrowing.
 */
export function isUserRoleFloorRejected(
  result: UserRoleFloorResult
): result is { ok: false; violation: UserRoleFloorViolation; message: string } {
  return result.ok === false;
}

/** Thrown by callers that have no result channel (model-level writes). */
export class UserRoleFloorError extends Error {
  readonly name = 'UserRoleFloorError';
  readonly statusCode = 409;
  constructor(message: string, readonly violation: UserRoleFloorViolation) {
    super(message);
  }
}

/** Recognises the error across bundle boundaries, where instanceof can fail. */
export function isUserRoleFloorError(error: unknown): error is UserRoleFloorError {
  return (
    error instanceof UserRoleFloorError
    || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'UserRoleFloorError')
  );
}

/**
 * Per-tenant floor lock. `pg_advisory_xact_lock` is transaction scoped, so it
 * is held through the caller's write: two requests that each remove a different
 * admin serialize, and the second one sees the first one's effect.
 */
export const USER_ROLE_FLOOR_LOCK_NAMESPACE = 'user_role_floor';

export async function lockUserRoleFloor(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
    USER_ROLE_FLOOR_LOCK_NAMESPACE,
    String(tenant),
  ]);
}

function assertTransaction(trx: Knex.Transaction | Knex, caller: string): asserts trx is Knex.Transaction {
  // knex sets `isTransaction = true` on every transaction object (and on
  // nested/savepoint transactions); a plain Knex instance has it undefined.
  if (!(trx as { isTransaction?: boolean }).isTransaction) {
    throw new Error(`${caller} must run inside a transaction: the role floor lock is transaction-scoped`);
  }
}

/**
 * The built-in MSP Admin role of a tenant, identified the way the rest of the
 * codebase does (`roles.msp = true` and a role named "admin", case-insensitive;
 * see policyActions.deleteRole). Returned as a list so a tenant carrying more
 * than one casing variant is handled, never as a single assumed row.
 */
async function mspAdminRoleIds(trx: Knex.Transaction, tenant: string): Promise<string[]> {
  return await tenantDb(trx, tenant).table('roles')
    .where({ msp: true })
    .whereRaw('lower(role_name) = ?', ['admin'])
    .pluck('role_id');
}

async function countOtherActiveMspAdmins(
  trx: Knex.Transaction,
  tenant: string,
  adminRoleIds: readonly string[],
  excludeUserIds: readonly string[]
): Promise<number> {
  const scopedDb = tenantDb(trx, tenant);
  const query = scopedDb.table('user_roles');
  scopedDb.tenantJoin(query, 'users', 'user_roles.user_id', 'users.user_id');

  const row = await query
    .whereIn('user_roles.role_id', adminRoleIds as string[])
    .whereNotIn('user_roles.user_id', excludeUserIds as string[])
    .where('users.user_type', 'internal')
    .where('users.is_inactive', false)
    .countDistinct('user_roles.user_id as count')
    .first();

  return parseInt(String((row as { count?: string | number } | undefined)?.count ?? '0'), 10);
}

/**
 * Evaluate one pending change against both floors. REQUIRES a transaction: the
 * first statement takes the per-tenant advisory lock before any read, and the
 * caller MUST perform its write in the same transaction so the decision cannot
 * go stale.
 *
 * Reads only — tenant is in every WHERE and JOIN through tenantDb, so the
 * queries are Citus-safe (no column references in an UPDATE anywhere here).
 *
 * An unknown user is allowed through: "user not found" is the caller's error to
 * report, not this guard's.
 *
 * `alsoAffectedUserIds` names the other users the same operation is changing
 * (bulk deactivation): they are excluded from the remaining-admin count, so a
 * request that deactivates every admin at once is refused as well.
 */
export async function assertUserRoleFloor(
  trx: Knex.Transaction | Knex,
  tenant: string,
  change: UserRoleFloorChange,
  options?: { alsoAffectedUserIds?: readonly string[] }
): Promise<UserRoleFloorResult> {
  assertTransaction(trx, 'assertUserRoleFloor');
  await lockUserRoleFloor(trx, tenant);

  const scopedDb = tenantDb(trx, tenant);
  const user = await scopedDb.table('users')
    .where({ user_id: change.userId })
    .first('user_id', 'user_type', 'is_inactive');

  if (!user) {
    return { ok: true };
  }

  const currentRoleIds: string[] = await scopedDb.table('user_roles')
    .where({ user_id: change.userId })
    .pluck('role_id');

  const finalRoleIds = (() => {
    if (change.kind === 'remove_roles') {
      const removed = new Set(change.roleIds);
      return currentRoleIds.filter((roleId) => !removed.has(roleId));
    }
    if (change.kind === 'set_roles') {
      return Array.from(new Set(change.roleIds));
    }
    // deactivate keeps the rows; delete takes them with the user.
    return currentRoleIds;
  })();

  const changesRoleSet = change.kind === 'remove_roles' || change.kind === 'set_roles';

  // Invariant 1 first: when the sole admin drops their only role both floors
  // are broken, and "the tenant needs an admin" is the one the operator can act
  // on (assigning another role would not let the removal through).
  // Only a change that drops this user's own active-admin contribution can take
  // the tenant below one admin.
  const adminRoleIds = await mspAdminRoleIds(trx, tenant);
  const adminRoles = new Set(adminRoleIds);
  const contributesAdmin =
    adminRoleIds.length > 0
    && user.user_type === 'internal'
    && user.is_inactive === false
    && currentRoleIds.some((roleId) => adminRoles.has(roleId));
  const keepsAdmin = changesRoleSet && finalRoleIds.some((roleId) => adminRoles.has(roleId));

  if (contributesAdmin && !keepsAdmin) {
    const excluded = [change.userId, ...(options?.alsoAffectedUserIds ?? [])];
    const otherAdmins = await countOtherActiveMspAdmins(trx, tenant, adminRoleIds, excluded);
    if (otherAdmins === 0) {
      return { ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE };
    }
  }

  // Invariant 2: never leave an interactive user with no role. Deleting the
  // user is exempt (their role rows go with them) and so are non-interactive
  // principals ('service'), which are not managed through user management.
  if (changesRoleSet && user.user_type !== 'service' && finalRoleIds.length === 0) {
    return { ok: false, violation: 'last_role', message: LAST_ROLE_MESSAGE };
  }

  return { ok: true };
}
