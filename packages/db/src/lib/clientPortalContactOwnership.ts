import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

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
