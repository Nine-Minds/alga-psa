import type { Knex } from 'knex';
import { isClientUserType } from '@alga-psa/types';
import { tenantDb } from './tenantDb';

/**
 * `contacts.is_client_admin` is a mirror of the client portal 'Admin' role, not
 * an independent switch. Every portal surface reads the flag — the visibility
 * resolver widens a portal user's ticket/asset/project scope from "their own"
 * to "the whole company" on it (authorization/portal/visibility.server) — so a
 * contact left flagged after their Admin role was taken away keeps seeing their
 * colleagues' tickets (ticket alga-2026-0003317).
 *
 * Lives in @alga-psa/db because the role writers sit in packages that may not
 * import one another (auth policyActions, users userActions) and the decision
 * must exist exactly once — the userRoleFloor convention.
 */

/**
 * The tenant's client portal 'Admin' role(s), identified the way the rest of
 * the codebase does (`roles.client = true` and a role named "admin",
 * case-insensitive; see userRoleFloor.mspAdminRoleIds and
 * portalInvitationActions). A list, never a single assumed row, so a tenant
 * carrying more than one casing variant is handled.
 */
async function holdsClientAdminRole(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<boolean> {
  const scopedDb = tenantDb(trx, tenant);
  const query = scopedDb.table('user_roles as ur')
    .where({ 'ur.user_id': userId, 'r.client': true })
    .whereRaw('lower(r.role_name) = ?', ['admin'])
    .first('ur.role_id');
  scopedDb.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
  return Boolean(await query);
}

/**
 * Recompute the linked contact's `is_client_admin` from the portal user's roles
 * and write it when it drifted. MUST run inside the caller's transaction, in
 * the same one as the role write, so the flag can never disagree with the roles
 * a reader would see.
 *
 * A no-op for anything that is not a portal user with a contact: MSP users and
 * service principals have no flag to keep, and a contact without a portal user
 * keeps the flag as the invitation pre-seed that it is (portalInvitationActions
 * reads it to pick the 'Admin' or 'User' role at account creation).
 */
export async function syncContactClientAdminFlag(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<void> {
  const scopedDb = tenantDb(trx, tenant);
  const user = await scopedDb.table('users')
    .where({ user_id: userId })
    .first('user_id', 'user_type', 'contact_id');

  if (!user || !isClientUserType(user.user_type) || !user.contact_id) {
    return;
  }

  const isClientAdmin = await holdsClientAdminRole(trx, tenant, userId);

  // `whereNot` keeps contacts.updated_at meaningful: a role change that does
  // not move the flag writes nothing.
  await scopedDb.table('contacts')
    .where({ contact_name_id: user.contact_id })
    .whereNot({ is_client_admin: isClientAdmin })
    .update({ is_client_admin: isClientAdmin, updated_at: new Date().toISOString() });
}
