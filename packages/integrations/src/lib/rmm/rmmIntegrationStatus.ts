/**
 * RMM integration status and device-sync configuration, without a session.
 *
 * Both the settings UI (via server actions) and the v1 API read and write
 * through here. The actions module carries 'use server', so its exports are
 * callable RPC endpoints and cannot be reused by an API route handler that has
 * already authenticated an API key — hence a plain module, taking knex and
 * tenant explicitly.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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
   * full sync also advances — anyone checking whether the schedule is working
   * needs the one the schedule writes.
   */
  lastIncrementalSyncAt: string | null;
}

// Imported for the clamp below and re-exported so existing importers of this
// module keep working; the values live in the dependency-free bounds module.
import {
  DEVICE_SYNC_MIN_MINUTES,
  DEVICE_SYNC_MAX_MINUTES,
  DEVICE_SYNC_DEFAULT_MINUTES,
} from './deviceSyncBounds';

export { DEVICE_SYNC_MIN_MINUTES, DEVICE_SYNC_MAX_MINUTES, DEVICE_SYNC_DEFAULT_MINUTES };

export function safeParseSettings(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function clampDeviceSyncInterval(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw)
    ? Math.min(DEVICE_SYNC_MAX_MINUTES, Math.max(DEVICE_SYNC_MIN_MINUTES, Math.round(raw)))
    : DEVICE_SYNC_DEFAULT_MINUTES;
}

export async function readRmmIntegrationStatuses(
  knex: Knex,
  tenant: string
): Promise<Record<string, RmmIntegrationStatus>> {
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

    statuses[row.provider] = {
      provider: row.provider,
      integrationId: String(row.integration_id),
      isActive: Boolean(row.is_active),
      deviceSyncEnabled: deviceSync?.enabled === true,
      deviceSyncIntervalMinutes: clampDeviceSyncInterval(deviceSync?.intervalMinutes),
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

  return statuses;
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
export async function writeDeviceSyncSettings(
  knex: Knex,
  tenant: string,
  input: { provider: RmmProvider; enabled: boolean; intervalMinutes?: number }
): Promise<{ found: boolean; intervalMinutes: number }> {
  // Clamped here as well as in any UI: a value that bypasses an input
  // constraint must not become a cron expression nobody intended.
  const intervalMinutes = clampDeviceSyncInterval(input.intervalMinutes);
  const db = tenantDb(knex, tenant);

  const row = await db.table('rmm_integrations')
    .where({ provider: input.provider })
    .first('integration_id', 'settings');
  if (!row) return { found: false, intervalMinutes };

  const settings = (typeof row.settings === 'string' ? safeParseSettings(row.settings) : row.settings) ?? {};
  const nextSettings = {
    ...(settings as Record<string, unknown>),
    deviceSync: { enabled: Boolean(input.enabled), intervalMinutes },
  };

  await db.table('rmm_integrations')
    .where({ integration_id: row.integration_id })
    .update({ settings: JSON.stringify(nextSettings), updated_at: knex.fn.now() });

  return { found: true, intervalMinutes };
}
