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

export type { RmmIntegrationStatus };

// Re-exported for callers that already import them from here. The values live
// in the lib module so the v1 API can share them without importing a
// 'use server' file.
export {
  DEVICE_SYNC_MIN_MINUTES,
  DEVICE_SYNC_MAX_MINUTES,
  DEVICE_SYNC_DEFAULT_MINUTES,
} from '../../lib/rmm/rmmIntegrationStatus';

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
