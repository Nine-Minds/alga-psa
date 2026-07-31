import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getJobRunner } from '../JobRunnerFactory';
import type { BaseJobData } from '../interfaces';

/**
 * Hudu daily auto-sync (EE-only) on the IJobRunner abstraction — the same
 * recurring-job path RMM alert polling, Huntress, and accounting-sync use
 * (pg-boss cron in CE, Temporal Schedule in EE). One recurring job per tenant
 * with an active Hudu connection AND settings.autoSync.enabled, keyed by
 * singletonKey `hudu-auto-sync:<tenant>`. scheduleHuduAutoSyncJob converges
 * the schedule from that desired state (called at startup + on
 * connect/disconnect/toggle); the handler re-checks eligibility per run.
 *
 * The real work (runHuduTenantSync) lives in EE Hudu code reached via a dynamic
 * @enterprise import, so the Temporal worker — which can't load EE Hudu code —
 * forwards this job to the server (see job-activities.ts), exactly like
 * accounting-sync-cycle.
 */

export interface HuduAutoSyncJobData extends BaseJobData {
  tenantId: string;
}

export const HUDU_AUTO_SYNC_JOB = 'hudu-auto-sync';
/** Daily at 02:00 UTC. */
const SYNC_CRON = '0 2 * * *';

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

interface HuduAutoSyncState {
  isActive: boolean;
  autoSyncEnabled: boolean;
}

/**
 * Desired state lives in EE (the connection table is EE-only and must not be
 * named in CE code — NFR7), so read it through the @enterprise dynamic import.
 * Resolves to the CE stub (→ null) in community builds.
 */
async function readHuduAutoSyncState(tenantId: string): Promise<HuduAutoSyncState | null> {
  const mod = await import('@enterprise/lib/integrations/hudu/tenantSync');
  if (typeof mod.getHuduAutoSyncDesiredState !== 'function') {
    return null;
  }
  return mod.getHuduAutoSyncDesiredState(tenantId);
}

/**
 * One scheduled tick for a tenant: import every mapped client's unmatched Hudu
 * assets then refresh existing. Eligibility is re-checked here so a schedule
 * that outlives a disconnect/disable between reconciles is a harmless no-op.
 */
export async function huduAutoSyncHandler(data: HuduAutoSyncJobData): Promise<void> {
  const { tenantId } = data;

  if (!isEnterpriseEdition()) {
    return;
  }

  const state = await readHuduAutoSyncState(tenantId);
  if (!state || !state.isActive || !state.autoSyncEnabled) {
    logger.info('[HuduAutoSync] Skipping: no connection / inactive / auto-sync disabled', { tenantId });
    return;
  }

  // Real engine lives in EE Hudu code; the CE stub never reaches here (handler
  // is EE-gated and only registered in the enterprise block).
  const mod = await import('@enterprise/lib/integrations/hudu/tenantSync');
  const runHuduTenantSync = mod.runHuduTenantSync;
  if (typeof runHuduTenantSync !== 'function') {
    logger.warn('[HuduAutoSync] runHuduTenantSync unavailable in this edition', { tenantId });
    return;
  }

  await runWithTenant(tenantId, async () => {
    const summary = await runHuduTenantSync(tenantId, { importNew: true });
    logger.info('[HuduAutoSync] cycle finished', {
      tenantId,
      clients: summary.clients,
      created: summary.items_created,
      updated: summary.items_updated,
      skipped: summary.items_skipped,
      failed: summary.items_failed,
      errors: summary.errors.length,
    });
  });
}

async function cancelHuduAutoSync(tenantId: string, singletonKey: string): Promise<void> {
  const adminKnex = await getAdminConnection();
  const existing = await adminKnex('jobs')
    .where({ tenant: tenantId })
    .whereRaw(`metadata->>'singletonKey' = ?`, [singletonKey])
    .whereNotNull('external_id')
    .orderBy('created_at', 'desc')
    .first('job_id');
  if (!existing?.job_id) return;

  const runner = await getJobRunner();
  await runner.cancelJob(String(existing.job_id), tenantId).catch((error) => {
    logger.info('[HuduAutoSync] schedule cancel skipped', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    return false;
  });
}

/**
 * Converge the daily schedule for a tenant via IJobRunner (pg-boss cron or
 * Temporal Schedule). Connected tenants with auto-sync enabled get a schedule;
 * everyone else has any leftover schedule cancelled. Idempotent — safe on
 * startup, connect, disconnect, and toggle.
 */
export async function scheduleHuduAutoSyncJob(tenantId: string): Promise<string | null> {
  if (!isEnterpriseEdition()) {
    return null;
  }

  const singletonKey = `${HUDU_AUTO_SYNC_JOB}:${tenantId}`;

  let state: HuduAutoSyncState | null;
  try {
    state = await readHuduAutoSyncState(tenantId);
  } catch (error) {
    // Couldn't read desired state (transient DB blip). Don't treat as disabled —
    // leave any existing schedule untouched; the next convergence retries.
    logger.warn('[HuduAutoSync] state read failed; leaving schedule unchanged', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }

  if (!state || !state.isActive || !state.autoSyncEnabled) {
    await cancelHuduAutoSync(tenantId, singletonKey);
    return null;
  }

  try {
    const runner = await getJobRunner();
    const result = await runner.scheduleRecurringJob<HuduAutoSyncJobData>(
      HUDU_AUTO_SYNC_JOB,
      { tenantId },
      SYNC_CRON,
      { singletonKey }
    );
    return result.jobId;
  } catch (error) {
    // "already exists" style errors are routine on startup re-registration.
    logger.info('[HuduAutoSync] schedule registration skipped', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
