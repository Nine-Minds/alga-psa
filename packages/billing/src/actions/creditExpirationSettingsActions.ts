'use server';

import { createTenantKnex } from '@alga-psa/db';
import { ICreditExpirationSettings } from '@alga-psa/types';

/**
 * Get credit expiration settings for a client.
 */
export async function getCreditExpirationSettings(
  clientId: string
): Promise<ICreditExpirationSettings> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('No tenant found');

  const clientSettings = await knex('client_billing_settings')
    .where({
      client_id: clientId,
      tenant,
    })
    .first();

  const defaultSettings = await knex('default_billing_settings').where({ tenant }).first();

  let enableCreditExpiration = true;
  if (clientSettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = clientSettings.enable_credit_expiration;
  } else if (defaultSettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = defaultSettings.enable_credit_expiration;
  }

  let creditExpirationDays: number | undefined;
  if (clientSettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = clientSettings.credit_expiration_days;
  } else if (defaultSettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = defaultSettings.credit_expiration_days;
  }

  let creditExpirationNotificationDays: number[] | undefined;
  if (clientSettings?.credit_expiration_notification_days !== undefined) {
    creditExpirationNotificationDays = clientSettings.credit_expiration_notification_days;
  } else if (defaultSettings?.credit_expiration_notification_days !== undefined) {
    creditExpirationNotificationDays = defaultSettings.credit_expiration_notification_days;
  }

  return {
    enable_credit_expiration: enableCreditExpiration,
    credit_expiration_days: creditExpirationDays,
    credit_expiration_notification_days: creditExpirationNotificationDays,
  };
}

/**
 * Update credit expiration settings for a client.
 */
export async function updateCreditExpirationSettings(
  clientId: string,
  settings: ICreditExpirationSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    await knex.transaction(async (trx) => {
      const existingSettings = await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant,
        })
        .first();

      const now = new Date().toISOString();

      if (existingSettings) {
        await trx('client_billing_settings')
          .where({
            client_id: clientId,
            tenant,
          })
          .update({
            enable_credit_expiration: settings.enable_credit_expiration,
            credit_expiration_days: settings.credit_expiration_days,
            credit_expiration_notification_days: settings.credit_expiration_notification_days,
            updated_at: now,
          });
      } else {
        await trx('client_billing_settings').insert({
          client_id: clientId,
          tenant,
          enable_credit_expiration: settings.enable_credit_expiration,
          credit_expiration_days: settings.credit_expiration_days,
          credit_expiration_notification_days: settings.credit_expiration_notification_days,
          created_at: now,
          updated_at: now,
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
        });
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating credit expiration settings:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

