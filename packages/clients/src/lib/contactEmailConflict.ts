import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  describeContactEmailConflict,
  resolveContactEmailOwnership,
  type ContactEmailConflictTranslate,
  type ContactEmailOwner,
} from '@alga-psa/shared/models/contactEmailOwnership';
import { hasMspPermission, isClientPortalUser } from './authHelpers';

export interface ContactEmailConflictCaller {
  tenant: string;
  user: IUserWithRoles;
  /** A client the caller is acting inside (a portal user's own client); an owner there is never "another client". */
  ownClientId?: string | null;
}

/**
 * The single visibility decision for a conflict's owning client: may this caller
 * read that client? It reuses the client read scope the contact and client lists
 * apply (permission + bundle/portfolio narrowing), so a conflict message can
 * never name a client the caller could not open. Anything that cannot be decided
 * answers "no": the message then says "another client".
 */
// LEVERAGE: friction contact-record-read-scope — there is no assertRecordReadAllowed for a record the caller did not
// load; "may this subject read that contact and its client?" is assembled here from permission + scope.permits().
// ContactService (REST) repeats the same two permits() calls; a shared record-read check would serve both.
export async function isConflictClientVisible(
  caller: ContactEmailConflictCaller | undefined,
  conflict: ContactEmailOwner,
  trx?: Knex.Transaction
): Promise<boolean> {
  if (!caller) return false;
  if (caller.ownClientId && conflict.clientId === caller.ownClientId) return true;
  if (isClientPortalUser(caller.user)) return false;

  // The owning contact and its client must both be inside the caller's read scope.
  const decide = async (conn: Knex.Transaction): Promise<boolean> => {
    if (!(await hasMspPermission(caller.user, 'contact', 'read', conn))) return false;
    if (conflict.clientId && !(await hasMspPermission(caller.user, 'client', 'read', conn))) return false;
    const scope = await createClientScopeContext(conn, caller.tenant, caller.user);
    if (conflict.clientId && !(await scope.permits('client', conflict.clientId))) return false;
    return scope.permits('contact', conflict.contactNameId);
  };

  try {
    if (trx) return await decide(trx);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, decide);
  } catch {
    return false;
  }
}

/** Resolve who owns `email` and say so in the caller's terms; null when nobody owns it. */
export async function describeOwnedEmail(
  trx: Knex.Transaction,
  caller: ContactEmailConflictCaller,
  email: string,
  t: ContactEmailConflictTranslate,
  options: { excludeContactId?: string } = {}
): Promise<{ conflict: ContactEmailOwner; message: string } | null> {
  const conflict = await resolveContactEmailOwnership(caller.tenant, email, trx);
  if (!conflict || conflict.contactNameId === options.excludeContactId) return null;
  const visible = await isConflictClientVisible(caller, conflict, trx);
  return { conflict, message: describeContactEmailConflict(conflict, visible, t) };
}
