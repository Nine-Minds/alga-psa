'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { ICreditExpirationSettings } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { updateClientBillingSettings as updateClientBillingSettingsShared } from '@shared/billingClients/billingSettings';

type CreditExpirationSettingsResult = ICreditExpirationSettings | ActionMessageError | ActionPermissionError;
type CreditExpirationMutationResult =
  | { success: boolean; error?: string }
  | ActionMessageError
  | ActionPermissionError;

function creditExpirationSettingsErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to update credit expiration settings';
  }

  if (error.message.startsWith('Permission denied:')) {
    return error.message;
  }

  return 'Failed to update credit expiration settings';
}

/**
 * Get credit expiration settings for a client.
 */
export const getCreditExpirationSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<CreditExpirationSettingsResult> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();
  if (!tenant) return actionError('Tenant context not found');

  const db = tenantDb(knex, tenant);
  const clientSettings = await db.table('client_billing_settings')
    .where({
      client_id: clientId,
    })
    .first();

  const defaultSettings = await db.table('default_billing_settings').first();

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
): Promise<CreditExpirationMutationResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) return actionError('Tenant context not found');

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
      error: creditExpirationSettingsErrorMessage(error),
    };
  }
});
