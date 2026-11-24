import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';
import { lockClientPortalMutations } from './clientPortalContactOwnership';
import { syncContactClientAdminFlag } from './clientPortalAdminFlag';

/**
 * The three ways `user_roles` is written, with the derived state that must
 * travel with the write.
 *
 * `contacts.is_client_admin` is a mirror of the client portal 'Admin' role
 * (tickets alga-2026-0003317 / alga-2026-0003347), and the portal visibility
 * resolver widens a portal user's ticket/asset/project scope from "their own"
 * to "the whole company" on it. When the flag sync was a line each writer had
 * to remember, five server actions remembered it and ten other writers — the
 * REST API among them — did not, so a role taken away through the API left the
 * contact flagged and still reading their colleagues' tickets.
 *
 * So the sequence is one function, not a convention: delete/insert plus
 * `syncContactClientAdminFlag`, in the caller's transaction. A new writer that
 * calls these cannot forget the flag; one that does not is caught by
 * userRoleWritePaths.contract.test.ts.
 *
 * Deliberately NOT in here: the role floors (userRoleFloor), the
 * seat-technician guard, role validation and audit logging. Those have
 * caller-specific error channels and messages, and they stay where they are.
 * Every helper here expects the caller to have run its guards already.
 */

export interface UserRoleWriteRow {
  tenant: string;
  user_id: string;
  role_id: string;
}

const USER_ROLE_CONFLICT_TARGET = ['tenant', 'user_id', 'role_id'] as const;

function assertTransaction(
  trx: Knex.Transaction | Knex,
  caller: string
): asserts trx is Knex.Transaction {
  // knex sets `isTransaction = true` on every transaction object (and on
  // nested/savepoint transactions); a plain Knex instance has it undefined.
  if (!(trx as { isTransaction?: boolean }).isTransaction) {
    throw new Error(
      `${caller} must run inside a transaction: the portal admin flag has to commit with the role write`
    );
  }
}

function uniqueRoleIds(roleIds: readonly string[]): string[] {
  return Array.from(new Set(roleIds.filter((roleId): roleId is string => Boolean(roleId))));
}

/**
 * Replace the user's whole role set with `roleIds` (an empty list clears it —
 * the caller's floor check is what refuses that where it matters).
 */
export async function setUserRoles(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userId: string,
  roleIds: readonly string[]
): Promise<void> {
  assertTransaction(trx, 'setUserRoles');
  await lockClientPortalMutations(trx, tenant);
  const scopedDb = tenantDb(trx, tenant);

  await scopedDb.table('user_roles').where({ user_id: userId }).del();

  const wanted = uniqueRoleIds(roleIds);
  if (wanted.length > 0) {
    await scopedDb.table('user_roles').insert(
      wanted.map((roleId) => ({ tenant, user_id: userId, role_id: roleId }))
    );
  }

  await syncContactClientAdminFlag(trx, tenant, userId);
}

/**
 * Add `roleIds` to the roles the user already holds. Idempotent: a role the
 * user already has is left alone (ON CONFLICT DO NOTHING, so a concurrent
 * insert of the same pair is not an error either).
 *
 * Returns the rows for the requested roles as they stand after the write, so a
 * caller that reports the assignment back to the UI has the row either way.
 */
export async function addUserRoles(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userId: string,
  roleIds: readonly string[]
): Promise<UserRoleWriteRow[]> {
  assertTransaction(trx, 'addUserRoles');
  await lockClientPortalMutations(trx, tenant);
  const scopedDb = tenantDb(trx, tenant);

  const wanted = uniqueRoleIds(roleIds);
  if (wanted.length > 0) {
    await scopedDb.table('user_roles')
      .insert(wanted.map((roleId) => ({ tenant, user_id: userId, role_id: roleId })))
      .onConflict(USER_ROLE_CONFLICT_TARGET as unknown as string[])
      .ignore();
  }

  await syncContactClientAdminFlag(trx, tenant, userId);

  if (wanted.length === 0) {
    return [];
  }

  return await scopedDb.table<UserRoleWriteRow>('user_roles')
    .where({ user_id: userId })
    .whereIn('role_id', wanted)
    .select('tenant', 'user_id', 'role_id');
}

/** Remove `roleIds` from the user, leaving any other role alone. */
export async function removeUserRoles(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userId: string,
  roleIds: readonly string[]
): Promise<number> {
  assertTransaction(trx, 'removeUserRoles');
  await lockClientPortalMutations(trx, tenant);
  const scopedDb = tenantDb(trx, tenant);

  const deleted = await scopedDb.table('user_roles')
    .where({ user_id: userId })
    .whereIn('role_id', uniqueRoleIds(roleIds))
    .del();

  await syncContactClientAdminFlag(trx, tenant, userId);

  return typeof deleted === 'number' ? deleted : 0;
}
