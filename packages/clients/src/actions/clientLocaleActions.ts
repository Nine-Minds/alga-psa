'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { SupportedLocale, isSupportedLocale } from '@alga-psa/ui/lib/i18n/config';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';

/**
 * Update client's default locale for all contacts
 */
export const updateClientLocaleAction = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  locale: SupportedLocale
) => {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const { knex } = await createTenantKnex();

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
});

/**
 * Get client's default locale
 */
export const getClientLocaleAction = withOptionalAuth(async (
  user,
  ctx,
  clientId: string
): Promise<SupportedLocale | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { tenant } = ctx;
  const { knex } = await createTenantKnex();

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
});
