'use server';

import { createTenantKnex } from '@alga-psa/db';
import { ICreditExpirationSettings } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { updateClientBillingSettings as updateClientBillingSettingsShared } from '@shared/billingClients/billingSettings';

/**
 * Get credit expiration settings for a client.
 */
export const getCreditExpirationSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ICreditExpirationSettings> => {
  const { knex } = await createTenantKnex();
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
});

/**
 * Update credit expiration settings for a client.
 */
export const updateCreditExpirationSettings = withAuth(async (
  user,
  { tenant },
  clientId: string,
  settings: ICreditExpirationSettings
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    await knex.transaction(async (trx) => {
      await updateClientBillingSettingsShared(trx, tenant, clientId, {
        enableCreditExpiration: settings.enable_credit_expiration,
        creditExpirationDays: settings.credit_expiration_days,
        creditExpirationNotificationDays: settings.credit_expiration_notification_days,
      });
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating credit expiration settings:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
});
