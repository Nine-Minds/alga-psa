'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import {
  PREPAID_BALANCE_ALERT_FLAG,
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

const FLAG_DISABLED_MESSAGE = 'Prepaid balance alerts are not enabled for this workspace';

async function featureEnabled(tenantId: string): Promise<boolean> {
  try {
    return await isFeatureFlagEnabled(PREPAID_BALANCE_ALERT_FLAG, { tenantId });
  } catch {
    // Missing, unavailable, or throwing flag infrastructure fails closed.
    return false;
  }
}

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
    return actionError('Tenant context not found');
  }
  if (!(await featureEnabled(tenant))) {
    return actionError(FLAG_DISABLED_MESSAGE);
  }
  if (!(await hasPermission(user, 'billing_settings', 'read'))) {
    return permissionError('Permission denied: billing_settings read required');
  }

  const { knex } = await createTenantKnex();
  if (!clientId) {
    return actionError('Client context not found');
  }
  const result = await getPrepaidBalanceAlertSettingsDb(knex, tenant, clientId);
  return result ?? actionError('Client not found');
});

/**
 * Persist only the four prepaid-alert policy columns. This deliberately does
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
    return actionError('Tenant context not found');
  }
  if (!(await featureEnabled(tenant))) {
    return actionError(FLAG_DISABLED_MESSAGE);
  }
  if (!(await hasPermission(user, 'billing_settings', 'update'))) {
    return permissionError('Permission denied: billing_settings update required');
  }

  const parsed = prepaidBalanceAlertSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError('Invalid prepaid balance alert settings');
  }

  try {
    const { knex } = await createTenantKnex();
    await knex.transaction(async (trx) => {
      await updatePrepaidBalanceAlertSettingsDb(trx, tenant, parsed.data);
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating prepaid balance alert settings:', error);
    return actionError('Failed to update prepaid balance alert settings');
  }
});
