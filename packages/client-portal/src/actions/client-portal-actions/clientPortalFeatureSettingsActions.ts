'use server';

import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  normalizeTenantSettings,
  resolveClientPortalFeatureSettings,
  type ClientPortalFeatureSettings,
} from '../../lib/clientPortalFeatureSettings';
import { getClientPortalFeatureSettingsForTenant } from '../../lib/clientPortalFeatureSettingsDb';

export const getClientPortalFeatureSettings = withAuth(async (
  _user,
  { tenant },
): Promise<ClientPortalFeatureSettings> => {
  const { knex } = await createTenantKnex();
  return getClientPortalFeatureSettingsForTenant(knex, tenant);
});

export const updateClientPortalFeatureSettings = withAuth(async (
  user,
  { tenant },
  updated: Partial<ClientPortalFeatureSettings>,
): Promise<ClientPortalFeatureSettings | ActionPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!(await hasPermission(user, 'settings', 'update', knex))) {
    return permissionError('Permission denied: settings:update required');
  }

  const scopedDb = tenantDb(knex, tenant);
  const existing = await scopedDb
    .table('tenant_settings')
    .select('settings')
    .first();
  const settings = normalizeTenantSettings(existing?.settings);
  const currentClientPortal = normalizeTenantSettings(settings.clientPortal);
  const nextClientPortal = {
    ...currentClientPortal,
    ...(updated.appointmentsEnabled === undefined
      ? {}
      : { appointmentsEnabled: updated.appointmentsEnabled }),
  };
  const nextSettings = {
    ...settings,
    clientPortal: nextClientPortal,
  };
  const now = new Date();

  await scopedDb
    .table('tenant_settings')
    .insert({
      tenant,
      settings: JSON.stringify(nextSettings),
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      settings: JSON.stringify(nextSettings),
      updated_at: now,
    });

  return resolveClientPortalFeatureSettings(nextSettings);
});
