'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { SupportedLocale, isSupportedLocale } from '@alga-psa/core/i18n/config';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import { assertMspOrClientPortalOwnClientPermission } from '../lib/authHelpers';

/**
 * Update client's default locale for all contacts
 */
export const updateClientLocaleAction = withAuth(async (
  user,
  { tenant },
  clientId: string,
  locale: SupportedLocale
) => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertMspOrClientPortalOwnClientPermission(
      user,
      tenant,
      clientId,
      'client',
      'update',
      'Permission denied: Cannot update client locale',
      trx
    );

    if (!isSupportedLocale(locale)) {
      throw new Error(`Unsupported locale: ${locale}`);
    }

    // Get existing client
    const client = await tenantDb(trx, tenant).table('clients')
      .where({
        client_id: clientId,
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

    await tenantDb(trx, tenant).table('clients')
      .where({
        client_id: clientId,
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
    await assertMspOrClientPortalOwnClientPermission(
      user,
      tenant,
      clientId,
      'client',
      'read',
      'Permission denied: Cannot read client locale',
      trx
    );

    return await tenantDb(trx, tenant).table('clients')
      .where({
        client_id: clientId,
      })
      .first();
  });

  const locale = client?.properties?.defaultLocale;
  return isSupportedLocale(locale) ? locale : null;
});
