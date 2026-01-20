'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { SupportedLocale, isSupportedLocale } from '@alga-psa/ui/lib/i18n/config';
import { getCurrentUserAsync } from '../lib/usersHelpers';

/**
 * Update client's default locale for all contacts
 */
export async function updateClientLocaleAction(
  clientId: string,
  locale: SupportedLocale
) {
  const user = await getCurrentUserAsync();
  if (!user) {
    throw new Error('User not found');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get existing client
    const client = await trx('clients')
      .where({
        client_id: clientId,
        tenant
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

    await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .update({
        properties: updatedProperties,
        updated_at: trx.fn.now()
      });
  });

  return { success: true };
}

/**
 * Get client's default locale
 */
export async function getClientLocaleAction(
  clientId: string
): Promise<SupportedLocale | null> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return null;
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return null;
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  const locale = client?.properties?.defaultLocale;
  return isSupportedLocale(locale) ? locale : null;
}
