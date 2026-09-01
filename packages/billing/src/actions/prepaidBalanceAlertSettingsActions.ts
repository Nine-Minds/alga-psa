'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  getPrepaidBalanceAlertSettingsDb,
  updatePrepaidBalanceAlertSettingsDb,
  prepaidBalanceAlertSettingsInputSchema,
  type PrepaidBalanceAlertSettingsInput,
  type PrepaidBalanceAlertSettingsWithDefault,
} from '@shared/billingClients/prepaidBalanceAlertSettings';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ReadResult = PrepaidBalanceAlertSettingsWithDefault | ActionMessageError | ActionPermissionError;
type UpdateResult = { success: true } | ActionMessageError | ActionPermissionError;

/**
 * Read the prepaid balance alert policy for one client. Tenant/client scoping
 * comes from the authenticated session; no caller-provided tenant is accepted.
 */
export const getPrepaidBalanceAlertSettings = withAuth(async (
  user,
  { tenant },
  clientId: string | null
): Promise<ReadResult> => {
  if (!tenant) {
    return actionError('Tenant context not found', 'msp/billing:errors.context.tenantContextNotFound');
  }
  if (!(await hasPermission(user, 'billing_settings', 'read'))) {
    return permissionError('Permission denied: billing_settings read required', 'msp/billing-settings:errors.permissions.settingsRead');
  }

  const { knex } = await createTenantKnex();
  if (!clientId) {
    return actionError('Client context not found', 'msp/billing:errors.context.clientContextNotFound');
  }
  const result = await getPrepaidBalanceAlertSettingsDb(knex, tenant, clientId);
  return result ?? actionError('Client not found', 'msp/billing:errors.client.notFound');
});

/**
 * Persist only the prepaid-alert policy and replenishment columns. This deliberately does
 * not route through the broad null-delete behavior of updateClientBillingSettings:
 * unrelated billing settings are never touched. Disabling both alert types
 * forces client opt-in off.
 */
export const updatePrepaidBalanceAlertSettings = withAuth(async (
  user,
  { tenant },
  input: PrepaidBalanceAlertSettingsInput
): Promise<UpdateResult> => {
  if (!tenant) {
    return actionError('Tenant context not found', 'msp/billing:errors.context.tenantContextNotFound');
  }
  if (!(await hasPermission(user, 'billing_settings', 'update'))) {
    return permissionError('Permission denied: billing_settings update required', 'msp/billing-settings:errors.permissions.settingsUpdate');
  }

  const parsed = prepaidBalanceAlertSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError('Invalid prepaid balance alert settings', 'msp/credits:errors.prepaidAlerts.settingsInvalid');
  }

  try {
    const { knex } = await createTenantKnex();
    await knex.transaction(async (trx) => {
      await updatePrepaidBalanceAlertSettingsDb(trx, tenant, parsed.data);
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating prepaid balance alert settings:', error);
    return actionError('Failed to update prepaid balance alert settings', 'msp/credits:errors.prepaidAlerts.updateFailed');
  }
});
