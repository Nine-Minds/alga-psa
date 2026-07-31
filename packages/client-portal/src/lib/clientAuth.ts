import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Resolves the authenticated client user's client_id.
 * Follows the chain: user -> contact -> client.
 * Reusable across all client portal actions.
 */
export async function getAuthenticatedClientId(
  trx: Knex.Transaction,
  userId: string,
  tenant: string
): Promise<string> {
  const scopedDb = tenantDb(trx, tenant);

  const userRecord = await scopedDb.table('users')
    .where({
      user_id: userId,
    })
    .first();

  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await scopedDb.table('contacts')
    .where({
      contact_name_id: userRecord.contact_id,
    })
    .first();

  if (!contact?.client_id) {
    throw new Error('Contact not associated with a client');
  }

  return contact.client_id;
}
