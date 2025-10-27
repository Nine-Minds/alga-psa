'use server';

import { getConnection } from '@/lib/db/db';
import { SupportedLocale, isSupportedLocale } from '@/lib/i18n/config';
import { getCurrentUser } from '@product/actions/user-actions/userActions';

/**
 * Update client's default locale for all contacts
 */
export async function updateClientLocaleAction(
  clientId: string,
  locale: SupportedLocale
) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not found');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(user.tenant);

  // Get existing client
  const client = await knex('clients')
    .where({
      client_id: clientId,
      tenant: user.tenant
    })
    .first();

  if (!client) {
    throw new Error('Client not found');
  }

  // Update properties JSONB with new locale
  const updatedProperties = {
    ...(client.properties || {}),
    defaultLocale: locale
  };

  await knex('clients')
    .where({
      client_id: clientId,
      tenant: user.tenant
    })
    .update({
      properties: updatedProperties,
      updated_at: knex.fn.now()
    });

  return { success: true };
}

/**
 * Get client's default locale
 */
export async function getClientLocaleAction(
  clientId: string
): Promise<SupportedLocale | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const knex = await getConnection(user.tenant);

  const client = await knex('clients')
    .where({
      client_id: clientId,
      tenant: user.tenant
    })
    .first();

  const locale = client?.properties?.defaultLocale;
  return isSupportedLocale(locale) ? locale : null;
}