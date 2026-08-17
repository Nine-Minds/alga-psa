/**
 * Run a device sync now, outside the schedule.
 *
 * Deliberately routed through the same registered strategy the rmm-device-sync
 * job uses, rather than each provider's own manual-sync action. Two paths that
 * ingest devices differently is exactly how a manual sync and a scheduled one
 * drift apart, and this whole piece of work started from a customer whose
 * inventory looked synced and was not.
 *
 * "full" is expressed as a cursor at the epoch rather than a separate code
 * path. Every provider's strategy filters on the device's own last-seen with an
 * inclusive lower bound and always admits a missing or unparseable value, so an
 * epoch cursor admits everything — the same sweep a full sync performs.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { RmmProvider } from '@alga-psa/types';

export type RmmSyncType = 'full' | 'incremental';

export interface RmmDeviceSyncTriggerResult {
  provider: RmmProvider;
  syncType: RmmSyncType;
  devicesProcessed: number;
  startedAt: string;
  finishedAt: string;
}

export class RmmProviderNotSchedulableError extends Error {
  constructor(public readonly provider: string) {
    super(`Device sync is not available for provider '${provider}'.`);
    this.name = 'RmmProviderNotSchedulableError';
  }
}

export class RmmIntegrationNotFoundError extends Error {
  constructor(public readonly provider: string) {
    super(`No ${provider} integration is configured for this tenant.`);
    this.name = 'RmmIntegrationNotFoundError';
  }
}

export class RmmIntegrationInactiveError extends Error {
  constructor(public readonly provider: string) {
    super(`The ${provider} integration is not active.`);
    this.name = 'RmmIntegrationInactiveError';
  }
}

/**
 * Where an on-demand incremental starts: the same cursor the scheduled job
 * uses, so triggering one does not re-read a window the schedule already
 * covered, nor skip one it has not.
 */
function resolveCursor(row: {
  last_incremental_sync_at?: unknown;
  last_full_sync_at?: unknown;
}): Date {
  const incremental = row.last_incremental_sync_at ? new Date(row.last_incremental_sync_at as string) : null;
  if (incremental && !Number.isNaN(incremental.getTime())) return incremental;

  const full = row.last_full_sync_at ? new Date(row.last_full_sync_at as string) : null;
  if (full && !Number.isNaN(full.getTime())) return full;

  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export async function triggerRmmDeviceSync(
  knex: Knex,
  tenant: string,
  provider: RmmProvider,
  syncType: RmmSyncType
): Promise<RmmDeviceSyncTriggerResult> {
  // Imported lazily: @alga-psa/jobs pulls the job runtime, which an API route
  // should not load merely to serve a status request.
  const { getRmmDeviceSyncStrategy, ensureRmmDeviceSyncStrategies } = await import(
    '@alga-psa/jobs/handlers/rmmAlertPollingHandlers'
  );
  await ensureRmmDeviceSyncStrategies();

  const strategy = getRmmDeviceSyncStrategy(provider);
  if (!strategy) throw new RmmProviderNotSchedulableError(provider);

  const row = await tenantDb(knex, tenant).table('rmm_integrations')
    .where({ provider })
    .first('integration_id', 'is_active', 'last_incremental_sync_at', 'last_full_sync_at');
  if (!row) throw new RmmIntegrationNotFoundError(provider);
  if (!row.is_active) throw new RmmIntegrationInactiveError(provider);

  const since = syncType === 'full' ? new Date(0) : resolveCursor(row);
  const startedAt = new Date();

  const result = await strategy.syncDevicesIncremental({
    tenantId: tenant,
    integrationId: String(row.integration_id),
    since,
  });

  // Advance the cursor only on success — the strategies throw on provider
  // failure precisely so a failed window is re-read rather than skipped.
  await tenantDb(knex, tenant).table('rmm_integrations')
    .where({ integration_id: row.integration_id })
    .update({
      last_incremental_sync_at: startedAt,
      last_sync_at: startedAt,
      ...(syncType === 'full' ? { last_full_sync_at: startedAt } : {}),
      sync_status: 'completed',
      sync_error: null,
      updated_at: knex.fn.now(),
    });

  return {
    provider,
    syncType,
    devicesProcessed: result.devicesProcessed,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}
