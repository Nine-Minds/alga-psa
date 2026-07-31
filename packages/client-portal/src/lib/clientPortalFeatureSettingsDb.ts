import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  resolveClientPortalFeatureSettings,
  type ClientPortalFeatureSettings,
} from './clientPortalFeatureSettings';

export async function getClientPortalFeatureSettingsForTenant(
  knex: Knex,
  tenant: string,
): Promise<ClientPortalFeatureSettings> {
  const row = await tenantDb(knex, tenant)
    .table('tenant_settings')
    .select('settings')
    .first();

  return resolveClientPortalFeatureSettings(row?.settings);
}
