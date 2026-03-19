import { Knex } from 'knex';

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
  const userRecord = await trx('users')
    .where({
      user_id: userId,
      tenant: tenant,
    })
    .first();

  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await trx('contacts')
    .where({
      contact_name_id: userRecord.contact_id,
      tenant: tenant,
    })
    .first();

  if (!contact?.client_id) {
    throw new Error('Contact not associated with a client');
  }

  return contact.client_id;
}
