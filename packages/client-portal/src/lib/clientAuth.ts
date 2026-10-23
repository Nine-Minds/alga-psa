import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ContactVisibilityContext } from '@alga-psa/authorization/portal/visibility';
import { getClientContactVisibilityContext } from '@alga-psa/authorization/portal/visibility.server';

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

/**
 * The authenticated portal user's visibility context (client, group scopes and
 * reports-to subtree): the one way portal project / device reads learn who the
 * user is and what they may see, instead of a hand-rolled contact -> client_id
 * lookup. Returns null for a non-client user, a user with no contact, or a
 * contact with no client; resolver errors (bad group assignment) propagate so
 * the caller fails closed.
 */
export async function getPortalVisibilityForUser(
  trx: Knex.Transaction,
  user: { user_type?: string | null; contact_id?: string | null },
  tenant: string
): Promise<ContactVisibilityContext | null> {
  if (user.user_type !== 'client' || !user.contact_id) return null;
  try {
    return await getClientContactVisibilityContext(trx, tenant, user.contact_id);
  } catch (error) {
    if (error instanceof Error && error.message === 'Contact not associated with a client') return null;
    throw error;
  }
}

/** As `getAuthenticatedClientId`, but returns the full visibility context (loads the contact from the user record). */
export async function getAuthenticatedPortalVisibility(
  trx: Knex.Transaction,
  userId: string,
  tenant: string
): Promise<ContactVisibilityContext> {
  const userRecord = await tenantDb(trx, tenant).table('users')
    .where({ user_id: userId })
    .first();
  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }
  return getClientContactVisibilityContext(trx, tenant, userRecord.contact_id);
}
