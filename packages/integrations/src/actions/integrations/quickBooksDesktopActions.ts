'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import {
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  normalizeQuickBooksDesktopSettings,
  type QuickBooksDesktopSettings,
} from '../../lib/quickBooksDesktopSettings';

type QuickBooksDesktopActionError = ActionMessageError | ActionPermissionError;

export type QuickBooksDesktopSettingsActionResult = QuickBooksDesktopSettings | QuickBooksDesktopActionError;

async function requireAccountingCapability(
  user: IUserWithRoles,
  action: 'catalog_read' | 'connections_manage',
  message: string,
  messageKey: string,
): Promise<QuickBooksDesktopActionError | null> {
  const allowed = await hasPermission(user, 'accounting_integrations', action);
  if (!allowed) {
    return permissionError(message, messageKey);
  }
  return null;
}

/**
 * Get QuickBooks Desktop (IIF) export settings for the current tenant.
 */
export const getQuickBooksDesktopSettings = withAuth(async (
  user,
  { tenant }
): Promise<QuickBooksDesktopSettingsActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'catalog_read',
    'User does not have permission to view integration settings',
    'msp/integrations:errors.quickbooksDesktop.viewSettingsPermission',
  );
  if (denied) return denied;

  const { knex } = await createTenantKnex();
  const row = await tenantDb(knex, tenant).table('tenant_settings')
    .select('settings')
    .first();

  return normalizeQuickBooksDesktopSettings(row?.settings?.quickbooksDesktop);
});

/**
 * Update QuickBooks Desktop (IIF) export settings for the current tenant.
 */
export const updateQuickBooksDesktopSettings = withAuth(async (
  user,
  { tenant },
  updates: Partial<QuickBooksDesktopSettings>
): Promise<QuickBooksDesktopSettingsActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'connections_manage',
    'User does not have permission to manage integration settings',
    'msp/integrations:errors.quickbooksDesktop.manageIntegrationsPermission',
  );
  if (denied) return denied;

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const existingRow = await db.table('tenant_settings')
    .select('settings')
    .first();

  const existingSettings = existingRow?.settings ?? {};
  const nextDesktopSettings = normalizeQuickBooksDesktopSettings({
    ...normalizeQuickBooksDesktopSettings(existingSettings.quickbooksDesktop),
    ...updates
  });

  const newSettings = {
    ...existingSettings,
    quickbooksDesktop: nextDesktopSettings
  };

  const now = new Date();

  if (existingRow) {
    await db.table('tenant_settings')
      .update({
        settings: JSON.stringify(newSettings),
        updated_at: now
      });
  } else {
    await db.table('tenant_settings').insert({
      tenant,
      settings: JSON.stringify(newSettings),
      onboarding_completed: false,
      onboarding_skipped: false,
      created_at: now,
      updated_at: now
    });
  }

  logger.info('[QuickBooksDesktopActions] Updated QuickBooks Desktop settings', { tenant });

  return nextDesktopSettings;
});
