'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { SupportedLocale, isSupportedLocale } from '@alga-psa/core/i18n/config';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import { assertMspOrClientPortalOwnClientPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ClientLocaleActionError = ActionMessageError | ActionPermissionError;

function localeActionErrorFrom(error: unknown): ClientLocaleActionError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  if (
    error.message.startsWith('Unsupported locale:') ||
    error.message === 'Client not found'
  ) {
    return actionError(error.message);
  }
  return null;
}

/**
 * Update client's default locale for all contacts
 */
export const updateClientLocaleAction = withAuth(async (
  user,
  { tenant },
  clientId: string,
  locale: SupportedLocale
): Promise<{ success: true } | ClientLocaleActionError> => {
  const { knex } = await createTenantKnex();

  try {
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
  } catch (error) {
    const expected = localeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  return { success: true };
});

/**
 * Get client's default locale
 */
export const getClientLocaleAction = withOptionalAuth(async (
  user,
  ctx,
  clientId: string
): Promise<SupportedLocale | null | ClientLocaleActionError> => {
  if (!user || !ctx) {
    return null;
  }

  const { tenant } = ctx;
  const { knex } = await createTenantKnex();

  let client: any;
  try {
    client = await withTransaction(knex, async (trx: Knex.Transaction) => {
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
  } catch (error) {
    const expected = localeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  const locale = client?.properties?.defaultLocale;
  return isSupportedLocale(locale) ? locale : null;
});
