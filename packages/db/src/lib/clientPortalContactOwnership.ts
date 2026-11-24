import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';
import { lockUserRoleFloor } from './userRoleFloor';

/**
 * Reserve a contact for one portal user until the caller's transaction ends.
 * Lock the contact, not a matching user: an unclaimed contact has no user row
 * to lock. The owner query must run AFTER acquiring the lock so a concurrent
 * API creation/relink sees the preceding transaction's committed owner.
 * Call before writing the user link, and keep roles and flag sync in this trx.
 */
export async function checkClientPortalContactAvailability(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string,
  currentUserId?: string,
): Promise<'available' | 'not_found' | 'occupied'> {
  if (!trx.isTransaction) {
    throw new Error('Portal contact ownership must be checked inside a transaction');
  }
  await lockClientPortalMutations(trx, tenant);
  const scopedDb = tenantDb(trx, tenant);
  const contact = await scopedDb.table('contacts')
    .where({ contact_name_id: contactId })
    .forUpdate()
    .first('contact_name_id');
  if (!contact) return 'not_found';

  const owners = scopedDb.table('users')
    .where({ contact_id: contactId, user_type: 'client' });
  if (currentUserId) owners.whereNot('user_id', currentUserId);
  return await owners.first('user_id') ? 'occupied' : 'available';
}

/**
 * Share the existing tenant role-floor lock: membership, role definitions and
 * portal links all affect the same derived flag. Take this before reading a
 * link or locking a contact, and retain it through the write and flag sync.
 * Reusing the floor lock avoids opposing lock orders with floor checks.
 */
export async function lockClientPortalMutations(trx: Knex.Transaction | Knex, tenant: string): Promise<void> {
  if (!(trx as Knex.Transaction).isTransaction) {
    throw new Error('Portal mutations must run inside a transaction');
  }
  await lockUserRoleFloor(trx as Knex.Transaction, tenant);
}

/** Shared ownership rule for model, registration and invitation writers. */
export async function assertClientPortalContactAvailable(
  trx: Knex.Transaction,
  tenant: string,
  userType: string | null | undefined,
  contactId: string | null | undefined,
  currentUserId?: string,
): Promise<void> {
  if (userType !== 'client' || !contactId) return;
  const availability = await checkClientPortalContactAvailability(trx, tenant, contactId, currentUserId);
  if (availability === 'not_found') throw new Error('Contact not found');
  if (availability === 'occupied') throw new Error('This contact already has a client portal user. Choose another contact.');
}
