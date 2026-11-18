/**
 * @alga-psa/integrations/runtime
 *
 * Runtime-safe exports for worker/shared server execution contexts.
 */

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS,
  normalizeQuickBooksDesktopSettings,
  type QuickBooksDesktopProductItemType,
  type QuickBooksDesktopSettings,
} from './lib/quickBooksDesktopSettings';

export { GmailAdapter } from './services/email/providers/GmailAdapter';
export {
  DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS,
  normalizeQuickBooksDesktopSettings,
  type QuickBooksDesktopProductItemType,
  type QuickBooksDesktopSettings,
};

export interface XeroCsvSettings {
  integrationMode: 'oauth' | 'csv';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  defaultCurrency: string;
  setupAcknowledged: boolean;
}

const DEFAULT_XERO_CSV_SETTINGS: XeroCsvSettings = {
  integrationMode: 'oauth',
  dateFormat: 'MM/DD/YYYY',
  defaultCurrency: '',
  setupAcknowledged: false,
};

export async function getQuickBooksDesktopSettingsForTenant(
  tenantId: string
): Promise<QuickBooksDesktopSettings> {
  const { knex, tenant } = await createTenantKnex(tenantId);
  if (!tenant) {
    return { ...DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS };
  }

  const tenantSettings = await tenantDb(knex, tenant).table('tenant_settings')
    .select('settings')
    .first();

  return normalizeQuickBooksDesktopSettings(tenantSettings?.settings?.quickbooksDesktop);
}

export async function getXeroCsvSettingsForTenant(
  tenantId: string
): Promise<XeroCsvSettings> {
  const { knex, tenant } = await createTenantKnex(tenantId);
  if (!tenant) {
    return { ...DEFAULT_XERO_CSV_SETTINGS };
  }

  const tenantSettings = await tenantDb(knex, tenant).table('tenant_settings')
    .select('settings')
    .first();

  const settings = tenantSettings?.settings ?? {};
  const xeroCsvSettings = settings.xeroCsv ?? {};

  return {
    ...DEFAULT_XERO_CSV_SETTINGS,
    ...xeroCsvSettings,
  };
}
