'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import type { RmmProvider } from '@alga-psa/types';
import {
  readRmmIntegrationStatuses,
  writeDeviceSyncSettings,
  type RmmIntegrationStatus,
} from '../../lib/rmm/rmmIntegrationStatus';

// The device-sync bounds are NOT re-exported here: a 'use server' module may
// only export async functions. Import shared types from lib/rmm/rmmIntegrationStatus
// and bounds from lib/rmm/contracts instead.

export const getRmmIntegrationStatuses = withAuth(async (user, { tenant }): Promise<{
  success: boolean;
  error?: string;
  statuses?: Record<string, RmmIntegrationStatus>;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    return { success: true, statuses: await readRmmIntegrationStatuses(knex, tenant) };
  } catch {
    return { success: false, error: 'Unable to load RMM integration statuses.' };
  }
});

export const updateRmmDeviceSyncSettings = withAuth(async (
  user,
  { tenant },
  input: { provider: RmmProvider; enabled: boolean; intervalMinutes?: number }
): Promise<{ success: boolean; error?: string; intervalMinutes?: number }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const result = await writeDeviceSyncSettings(knex, tenant, input);
    if (!result.found) return { success: false, error: 'Integration not found.' };
    return { success: true, intervalMinutes: result.intervalMinutes };
  } catch {
    return { success: false, error: 'Unable to update device sync settings.' };
  }
});
