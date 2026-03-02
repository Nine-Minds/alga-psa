/**
 * @alga-psa/integrations/runtime
 *
 * Runtime-safe exports for worker/shared server execution contexts.
 */

import { createTenantKnex } from '@alga-psa/db';

export { GmailAdapter } from './services/email/providers/GmailAdapter';

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

export async function getXeroCsvSettingsForTenant(
  tenantId: string
): Promise<XeroCsvSettings> {
  const { knex, tenant } = await createTenantKnex(tenantId);
  if (!tenant) {
    return { ...DEFAULT_XERO_CSV_SETTINGS };
  }

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .select('settings')
    .first();

  const settings = tenantSettings?.settings ?? {};
  const xeroCsvSettings = settings.xeroCsv ?? {};

  return {
    ...DEFAULT_XERO_CSV_SETTINGS,
    ...xeroCsvSettings,
  };
}
