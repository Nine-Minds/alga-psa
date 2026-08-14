'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { RmmProvider } from '@alga-psa/types';

export interface RmmIntegrationStatus {
  provider: RmmProvider;
  integrationId: string;
  isActive: boolean;
  syncStatus: string | null;
  syncError: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  deviceCount: number;
  /** Recurring device sync, as stored in settings.deviceSync. */
  deviceSyncEnabled: boolean;
  deviceSyncIntervalMinutes: number;
  /**
   * Last successful scheduled run. Distinct from lastSyncAt, which a manual
   * full sync also advances — an operator checking whether the schedule is
   * working needs the one the schedule writes.
   */
  lastIncrementalSyncAt: string | null;
}

/** Mirrors the clamp the reconciler applies; the UI must not offer what the server will not honour. */
export const DEVICE_SYNC_MIN_MINUTES = 15;
export const DEVICE_SYNC_MAX_MINUTES = 1440;
export const DEVICE_SYNC_DEFAULT_MINUTES = 60;

export const getRmmIntegrationStatuses = withAuth(async (user, { tenant }): Promise<{
  success: boolean;
  error?: string;
  statuses?: Record<string, RmmIntegrationStatus>;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const [integrations, deviceCounts] = await Promise.all([
      db.table('rmm_integrations')
        .select([
          'provider',
          'integration_id',
          'is_active',
          'sync_status',
          'sync_error',
          'connected_at',
          'last_sync_at',
          'last_incremental_sync_at',
          'settings',
        ]),
      db.table('assets')
        .whereNotNull('rmm_provider')
        .select('rmm_provider')
        .count({ count: 'asset_id' })
        .groupBy('rmm_provider') as Promise<Array<{ rmm_provider: string; count: string | number }>>,
    ]);

    const countsByProvider = new Map(deviceCounts.map((row) => [row.rmm_provider, Number(row.count)]));

    const statuses: Record<string, RmmIntegrationStatus> = {};
    for (const row of integrations) {
      const settings = (typeof row.settings === 'string' ? safeParseSettings(row.settings) : row.settings) ?? {};
      const deviceSync = (settings as Record<string, unknown>).deviceSync as
        | { enabled?: unknown; intervalMinutes?: unknown }
        | undefined;
      const rawInterval = Number(deviceSync?.intervalMinutes);

      statuses[row.provider] = {
        provider: row.provider,
        integrationId: String(row.integration_id),
        isActive: Boolean(row.is_active),
        deviceSyncEnabled: deviceSync?.enabled === true,
        deviceSyncIntervalMinutes: Number.isFinite(rawInterval)
          ? Math.min(DEVICE_SYNC_MAX_MINUTES, Math.max(DEVICE_SYNC_MIN_MINUTES, Math.round(rawInterval)))
          : DEVICE_SYNC_DEFAULT_MINUTES,
        lastIncrementalSyncAt: row.last_incremental_sync_at
          ? new Date(row.last_incremental_sync_at).toISOString()
          : null,
        syncStatus: row.sync_status ?? null,
        syncError: row.sync_error ?? null,
        connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
        lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
        deviceCount: countsByProvider.get(row.provider) ?? 0,
      };
    }

    return { success: true, statuses };
  } catch {
    return { success: false, error: 'Unable to load RMM integration statuses.' };
  }
});

function safeParseSettings(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Turn the recurring device sync on or off for one integration, and set its
 * cadence.
 *
 * Writes settings.deviceSync only, merging into whatever else the integration
 * stores there — alertPolling lives in the same column, and replacing the
 * object would silently disable alert polling.
 *
 * The reconciler picks the change up on its next pass (a few minutes); nothing
 * here schedules or cancels directly, so the control loop stays the single
 * place that decides what schedules exist.
 */
export const updateRmmDeviceSyncSettings = withAuth(async (
  user,
  { tenant },
  input: { provider: RmmProvider; enabled: boolean; intervalMinutes?: number }
): Promise<{ success: boolean; error?: string; intervalMinutes?: number }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  // Clamped server-side as well as in the UI: a value that bypasses the input
  // constraint must not become a cron expression nobody intended.
  const raw = Number(input.intervalMinutes);
  const intervalMinutes = Number.isFinite(raw)
    ? Math.min(DEVICE_SYNC_MAX_MINUTES, Math.max(DEVICE_SYNC_MIN_MINUTES, Math.round(raw)))
    : DEVICE_SYNC_DEFAULT_MINUTES;

  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const row = await db.table('rmm_integrations')
      .where({ provider: input.provider })
      .first('integration_id', 'settings');
    if (!row) return { success: false, error: 'Integration not found.' };

    const settings = (typeof row.settings === 'string' ? safeParseSettings(row.settings) : row.settings) ?? {};
    const nextSettings = {
      ...(settings as Record<string, unknown>),
      deviceSync: { enabled: Boolean(input.enabled), intervalMinutes },
    };

    await db.table('rmm_integrations')
      .where({ integration_id: row.integration_id })
      .update({ settings: JSON.stringify(nextSettings), updated_at: knex.fn.now() });

    return { success: true, intervalMinutes };
  } catch {
    return { success: false, error: 'Unable to update device sync settings.' };
  }
});
