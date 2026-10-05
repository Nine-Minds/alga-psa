import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import type { BaseJobData } from '../interfaces';

/**
 * Hudu daily auto-sync (EE-only). One global Temporal schedule
 * (maintenance-fanout:hudu-auto-sync, 02:00 UTC) fans this handler out across
 * tenants with an active Hudu connection AND settings.autoSync.enabled (see
 * registerServerMaintenanceJobs). Eligibility is re-checked per run, so a
 * toggle or disconnect takes effect on the next tick without any schedule
 * convergence.
 *
 * The real work (runHuduTenantSync) lives in EE Hudu code reached via a dynamic
 * @enterprise import, which is why it runs server-side through the
 * MAINTENANCE_JOB_REQUESTED subscriber rather than in the Temporal worker.
 */

export interface HuduAutoSyncJobData extends BaseJobData {
  tenantId: string;
}

export const HUDU_AUTO_SYNC_JOB = 'hudu-auto-sync';
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
