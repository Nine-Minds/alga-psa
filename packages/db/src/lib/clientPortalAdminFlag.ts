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
 * Before the portal user exists the flag runs the other way round: it is the
 * invitation pre-mark the MSP sets on the contact ("the user will be created
 * with Client Admin role"), and `resolveInitialPortalRoleId` below is what every
 * account-creation path reads it with. Mirror afterwards, pre-mark before —
 * both directions live here so they cannot disagree.
 *
 * Lives in @alga-psa/db because the role writers sit in packages that may not
 * import one another (auth policyActions, users userActions) and the decision
 * must exist exactly once — the userRoleFloor convention.
 */

/**
 * Whether any of `userIds` holds a client portal 'Admin' role, identified the
 * way the rest of the codebase does (`roles.client = true` and a role named
 * "admin", case-insensitive; see userRoleFloor.mspAdminRoleIds and
 * portalInvitationActions). Role casing variants are all matched, so a tenant
 * carrying more than one is handled.
 */
async function anyHoldsClientAdminRole(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userIds: readonly string[],
): Promise<boolean> {
  if (userIds.length === 0) {
    return false;
  }
  const scopedDb = tenantDb(trx, tenant);
  const query = scopedDb.table('user_roles as ur')
    .whereIn('ur.user_id', [...userIds])
    .where({ 'r.client': true })
    .whereRaw('lower(r.role_name) = ?', ['admin'])
    .first('ur.role_id');
  scopedDb.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
  return Boolean(await query);
}

/** The portal users (`users.user_type = 'client'`) linked to a contact. */
async function linkedPortalUserIds(
  trx: Knex.Transaction | Knex,
  tenant: string,
  contactId: string,
): Promise<string[]> {
  const rows = await tenantDb(trx, tenant).table('users')
    .where({ contact_id: contactId })
    .select('user_id', 'user_type');
  return rows
    .filter((row: { user_type?: string | null }) => isClientUserType(row.user_type))
    .map((row: { user_id: string }) => row.user_id);
}

/**
 * Recompute one contact's `is_client_admin` from the roles of the portal
 * user(s) linked to it and write it when it drifted.
 *
 * `users.contact_id` is indexed but not unique, so a contact can carry more
 * than one portal account. The flag is one per contact, and the rule — the same
 * one the repair migrations converge on — is that it is true when ANY linked
 * portal user holds the client 'Admin' role. Deriving it from only the user
 * just written would let a second, plain 'User' account clear the flag its
 * admin colleague's access depends on.
 *
 * A contact with no portal user at all is left alone: there the flag is the
 * invitation pre-mark, not a mirror (see `resolveInitialPortalRoleId`).
 */
export async function syncContactClientAdminFlagForContact(
  trx: Knex.Transaction | Knex,
  tenant: string,
  contactId: string,
): Promise<void> {
  const userIds = await linkedPortalUserIds(trx, tenant, contactId);
  if (userIds.length === 0) {
    return;
  }

  const isClientAdmin = await anyHoldsClientAdminRole(trx, tenant, userIds);

  // `whereNot` keeps contacts.updated_at meaningful: a role change that does
  // not move the flag writes nothing.
  await tenantDb(trx, tenant).table('contacts')
    .where({ contact_name_id: contactId })
    .whereNot({ is_client_admin: isClientAdmin })
    .update({ is_client_admin: isClientAdmin, updated_at: new Date().toISOString() });
}

/**
 * Recompute the linked contact's `is_client_admin` after a role write. MUST run
 * inside the caller's transaction, in the same one as the write, so the flag can
 * never disagree with the roles a reader would see.
 *
 * A no-op for anything that is not a portal user with a contact: MSP users and
 * service principals have no flag to keep.
 */
export async function syncContactClientAdminFlag(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userId: string,
): Promise<void> {
  const user = await tenantDb(trx, tenant).table('users')
    .where({ user_id: userId })
    .first('user_id', 'user_type', 'contact_id');

  if (!user || !isClientUserType(user.user_type) || !user.contact_id) {
    return;
  }

  await syncContactClientAdminFlagForContact(trx, tenant, user.contact_id);
}

/**
 * Recompute the flag after a write that moved the user itself rather than its
 * roles: a changed `users.contact_id` (the invitation relink, the REST update)
 * or a changed `users.user_type`. Both the contact the user now points at and
 * the one it left are re-derived, because the same role rows mean something
 * different for each of them — otherwise a 'User'-role account relinked to a
 * pre-marked contact keeps that contact's company-wide portal scope.
 *
 * Pass `previousContactId` when the caller read the row before the write; the
 * current link is looked up here.
 */
export async function syncContactClientAdminFlagsForUserLinkChange(
  trx: Knex.Transaction | Knex,
  tenant: string,
  userId: string,
  previousContactId?: string | null,
): Promise<void> {
  const user = await tenantDb(trx, tenant).table('users')
    .where({ user_id: userId })
    .first('user_id', 'contact_id');

  const contactIds = new Set<string>();
  if (previousContactId) {
    contactIds.add(previousContactId);
  }
  if (user?.contact_id) {
    contactIds.add(user.contact_id);
  }

  for (const contactId of contactIds) {
    await syncContactClientAdminFlagForContact(trx, tenant, contactId);
  }
}

/**
 * The client portal role a brand-new portal user for `contactId` must be
 * created with: the contact's `is_client_admin` pre-mark picks the client
 * 'Admin' role, anything else `defaultRoleName` (the portal 'User' role, or the
 * role an Entra sync is configured with).
 *
 * This is the promise the MSP contact screen makes — "when enabled, the user
 * will be created with Client Admin role" — and every creation path has to keep
 * it. The paths that only ever assigned 'User' took the pre-mark away the
 * moment the account was created, because the flag then follows the role.
 *
 * Returns null when neither role exists, so each caller keeps its own error
 * channel (a thrown message, a `role_conflict` outcome).
 */
export async function resolveInitialPortalRoleId(
  trx: Knex.Transaction | Knex,
  tenant: string,
  contactId: string | null | undefined,
  defaultRoleName = 'User',
): Promise<string | null> {
  const scopedDb = tenantDb(trx, tenant);

  const contact = contactId
    ? await scopedDb.table('contacts')
      .where({ contact_name_id: contactId })
      .first('is_client_admin')
    : null;

  const findClientRole = async (roleName: string): Promise<string | null> => {
    const role = await tenantDb(trx, tenant).table('roles')
      .where({ client: true })
      .whereRaw('lower(role_name) = ?', [roleName.trim().toLowerCase()])
      .first('role_id');
    return role?.role_id ?? null;
  };

  if (contact?.is_client_admin) {
    // Falls back to the default role when the tenant has no client 'Admin'
    // role: an account with a role beats an account with none, and the sync
    // that follows the write records honestly that the contact is not an admin.
    return (await findClientRole('admin')) ?? (await findClientRole(defaultRoleName));
  }

  return await findClientRole(defaultRoleName);
}
