/**
 * 'rmm-inventory-sync' — the whole-fleet NinjaOne software / patch syncs as one
 * background job.
 *
 * These syncs walk every device (batches of 25–50, one provider call per device,
 * a pause between batches): minutes for a big fleet, far beyond a server-action
 * request. The trigger actions schedule this job and return immediately; the
 * Fleet Compliance panel polls `getJobProgressAction` for live progress and
 * reads the durable outcome from `rmm_integrations.settings.inventorySync[kind]`.
 *
 * One job name for every inventory kind, dispatched through INVENTORY_SYNC_RUNNERS
 * (the same provider/kind registry shape the RMM pollers use): a third kind is one
 * entry here plus one translation key, not a new job and new progress plumbing.
 *
 * Like the other RMM handlers, eligibility is re-checked per run, so a job that
 * outlives a disconnect / suspension / expired credentials is a harmless no-op.
 */

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';
import {
  RMM_INVENTORY_SYNC_JOB,
  inventorySyncSettingsPatch,
  type RmmInventorySyncKind,
  type RmmInventorySyncOutcome,
} from '@alga-psa/shared/rmm/inventorySync';
import type { Knex } from 'knex';
import type { BaseJobData } from '../jobs/interfaces';
import { isIntegrationReconnectRequired } from './rmmAlertPollingHandlers';

export { RMM_INVENTORY_SYNC_JOB };

export interface RmmInventorySyncJobData extends BaseJobData {
  tenantId: string;
  integrationId: string;
  provider: 'ninjaone';
  kind: RmmInventorySyncKind;
  assetIds?: string[];
  trackChanges?: boolean;
  /** Audit only (asset_history.changed_by) — never used for authorization; the action already authorized. */
  performedBy?: string;
}

/** The slice of both sync result types the handler needs. */
interface InventorySyncRunResult {
  status: 'succeeded' | 'partial' | 'failed';
  assetsProcessed: number;
  assetsUpdated: number;
  assetsFailed: number;
  errorCount: number;
  errors: string[];
}

interface InventorySyncRunOptions {
  assetIds?: string[];
  trackChanges?: boolean;
  performedBy?: string;
  onProgress: (done: number, total: number) => void;
}

type InventorySyncRunner = (
  tenantId: string,
  integrationId: string,
  options: InventorySyncRunOptions,
) => Promise<InventorySyncRunResult>;

// The sync engines are EE-only; reach them through @enterprise like the other
// NinjaOne pieces (resolves to a CE stub in community builds, where the import
// fails and the run is recorded as failed).
export const INVENTORY_SYNC_RUNNERS: Record<RmmInventorySyncKind, InventorySyncRunner> = {
  software: async (tenant, integrationId, opts) => {
    const mod = await import('@enterprise/lib/integrations/ninjaone/sync/softwareSync');
    return mod.syncSoftwareInventory(tenant, integrationId, opts);
  },
  patches: async (tenant, integrationId, opts) => {
    const mod = await import('@enterprise/lib/integrations/ninjaone/sync/patchSync');
    return mod.syncPatchStatus(tenant, integrationId, { ...opts });
  },
};

function parseSettings(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'string') {
    try {
      return JSON.parse(settings);
    } catch {
      return {};
    }
  }
  return (settings ?? {}) as Record<string, unknown>;
}

/**
 * One job_details row per batch, so getJobProgressAction can show "412 / 831".
 * Progress is bookkeeping: it must never fail the sync.
 */
async function writeProgressRow(
  knex: Knex,
  tenant: string,
  jobRecordId: string,
  kind: RmmInventorySyncKind,
  done: number,
  total: number,
): Promise<void> {
  try {
    const payload = JSON.stringify({ kind, done, total });
    await tenantDb(knex, tenant).table('job_details').insert({
      tenant,
      job_id: jobRecordId,
      step_name: `${kind}-batch`,
      status: 'completed',
      processed_at: new Date(),
      retry_count: 0,
      metadata: payload,
      result: payload,
    });
  } catch (error) {
    logger.warn('[RmmInventorySyncJob] Failed to record progress', {
      jobRecordId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeOutcome(
  knex: Knex,
  data: RmmInventorySyncJobData,
  outcome: RmmInventorySyncOutcome,
): Promise<void> {
  await tenantDb(knex, data.tenantId)
    .table('rmm_integrations')
    .where({ integration_id: data.integrationId })
    .update({
      settings: inventorySyncSettingsPatch(knex, data.kind, outcome) as never,
      updated_at: knex.fn.now(),
    });
}

/** The page reads the outcome from settings; the job runs outside a request, so this is best-effort. */
async function revalidateAssetsPage(): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/msp/assets');
    revalidatePath('/msp/settings');
  } catch {
    // No Next request/static-generation store here (pg-boss / Temporal worker): nothing to revalidate.
  }
}

export async function rmmInventorySyncHandler(
  jobId: string,
  data: RmmInventorySyncJobData,
): Promise<void> {
  const run = INVENTORY_SYNC_RUNNERS[data.kind];
  if (!run) {
    logger.warn('[RmmInventorySyncJob] Unknown inventory kind; skipping', data);
    return;
  }

  const knex = await getAdminConnection();
  const row = await tenantDb(knex, data.tenantId)
    .table('rmm_integrations')
    .where({ integration_id: data.integrationId })
    .first('is_active', 'settings');

  // Re-check eligibility per run (same gates as rmmDeviceSyncHandler): a queued
  // job that outlives a disconnect must be a no-op, not an API-key error in
  // someone's settings panel. Nothing is written — the schedule-time `running`
  // record is recognised as stale by the action once this job is terminal.
  if (!row || !row.is_active) {
    logger.info('[RmmInventorySyncJob] Skipping: integration missing or inactive', data);
    return;
  }

  const tenantRow = await tenantDb(knex, data.tenantId).table('tenants').first('suspended_at');
  if (tenantRow?.suspended_at) {
    logger.info('[RmmInventorySyncJob] Skipping: tenant suspended', data);
    return;
  }

  if (isIntegrationReconnectRequired(parseSettings(row.settings))) {
    logger.info('[RmmInventorySyncJob] Skipping: integration requires reconnect', data);
    return;
  }

  const jobRecordId = data.jobServiceId || jobId;
  const startedAt = new Date().toISOString();
  let outcome: RmmInventorySyncOutcome;

  try {
    // Fire-and-forget progress writes are chained so rows land in batch order.
    let progressWrites: Promise<void> = Promise.resolve();
    const result = await run(data.tenantId, data.integrationId, {
      assetIds: data.assetIds,
      trackChanges: data.trackChanges,
      performedBy: data.performedBy,
      onProgress: (done, total) => {
        progressWrites = progressWrites.then(() =>
          writeProgressRow(knex, data.tenantId, jobRecordId, data.kind, done, total),
        );
      },
    });
    await progressWrites;

    outcome = {
      status: result.status,
      assetsProcessed: result.assetsProcessed,
      assetsUpdated: result.assetsUpdated,
      assetsFailed: result.assetsFailed,
      errorCount: result.errorCount,
      errors: result.errors,
      startedAt,
      completedAt: new Date().toISOString(),
      jobId: jobRecordId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[RmmInventorySyncJob] Sync threw', { ...data, error: message });
    outcome = {
      status: 'failed',
      assetsProcessed: 0,
      assetsUpdated: 0,
      assetsFailed: 0,
      errorCount: 1,
      errors: [message],
      startedAt,
      completedAt: new Date().toISOString(),
      jobId: jobRecordId,
    };
  }

  await writeOutcome(knex, data, outcome);
  await revalidateAssetsPage();

  logger.info('[RmmInventorySyncJob] complete', {
    tenantId: data.tenantId,
    integrationId: data.integrationId,
    kind: data.kind,
    status: outcome.status,
    assetsProcessed: outcome.assetsProcessed,
    assetsFailed: outcome.assetsFailed,
  });
}
