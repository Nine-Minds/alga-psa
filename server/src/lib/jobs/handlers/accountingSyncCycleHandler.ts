import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getJobRunner } from '../JobRunnerFactory';
import type { BaseJobData } from '../interfaces';
import { runAccountingSyncCycle, AccountingAdapterRegistry } from '@alga-psa/billing/services';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';

export interface AccountingSyncCycleJobData extends BaseJobData {
  tenantId: string;
}

const JOB_NAME = 'accounting-sync-cycle';
const ADAPTER_TYPE = 'quickbooks_online';
/** Every 15 minutes; runs through the IJobRunner cron path (NOT the legacy 24h-coerced scheduler). */
const CYCLE_CRON = '*/15 * * * *';

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

/**
 * One scheduled tick for a tenant: enumerate connected realms and run a sync
 * cycle per realm. The cycle is only scheduled for connected tenants (see
 * scheduleAccountingSyncCycleJob); the realm guard below stays as a safety net
 * for the window between a disconnect and the next convergence.
 */
export async function accountingSyncCycleHandler(data: AccountingSyncCycleJobData): Promise<void> {
  const { tenantId } = data;

  if (!isEnterpriseEdition()) {
    return;
  }

  const credentials = await getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, any>));
  const realms = Object.keys(credentials);
  if (realms.length === 0) {
    return; // cycle guard: no connection, nothing to do
  }

  const registry = await AccountingAdapterRegistry.createDefault();
  const adapter = registry.get(ADAPTER_TYPE);
  if (!adapter) {
    logger.warn('[accountingSync] No adapter registered for scheduled cycle', { tenantId });
    return;
  }

  const knex = await getConnection(tenantId);

  await runWithTenant(tenantId, async () => {
    for (const realm of realms) {
      try {
        const result = await runAccountingSyncCycle({
          knex,
          tenantId,
          adapterType: ADAPTER_TYPE,
          targetRealm: realm,
          adapter,
          refreshTokenExpiresAt: credentials[realm]?.refreshTokenExpiresAt ?? null
        });
        if (result.ran) {
          logger.info('[accountingSync] Scheduled cycle finished', {
            tenantId,
            realm,
            status: result.status,
            stats: result.stats
          });
        }
      } catch (error) {
        logger.error('[accountingSync] Scheduled cycle crashed', {
          tenantId,
          realm,
          error: error instanceof Error ? error.message : error
        });
      }
    }
  });
}

// Throws if credentials can't be read (e.g. a transient secret-store error) so
// the caller can distinguish "genuinely disconnected" from "couldn't tell" — the
// latter must NOT cancel a connected tenant's schedule.
async function tenantHasConnectedRealm(tenantId: string): Promise<boolean> {
  const credentials = await getStoredQboCredentialsMap(tenantId);
  return Object.keys(credentials).length > 0;
}

async function cancelAccountingSyncCycle(tenantId: string, singletonKey: string): Promise<void> {
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
    logger.info('[accountingSync] Cycle cancel skipped', {
      tenantId,
      error: error instanceof Error ? error.message : error
    });
    return false;
  });
}

/**
 * Converge the recurring 15-minute cycle for a tenant via the IJobRunner
 * abstraction (pg-boss cron schedule or Temporal schedule). Connected tenants
 * get a schedule; tenants with no connected accounting realm have any leftover
 * schedule cancelled. Idempotent — safe to call on startup, connect and
 * disconnect. The handler's realm guard remains a safety net for the window
 * between a disconnect and the next convergence.
 */
export async function scheduleAccountingSyncCycleJob(tenantId: string): Promise<string | null> {
  if (!isEnterpriseEdition()) {
    return null;
  }

  const singletonKey = `${JOB_NAME}:${tenantId}`;

  let hasRealm: boolean;
  try {
    hasRealm = await tenantHasConnectedRealm(tenantId);
  } catch (error) {
    // Couldn't read credentials (e.g. a transient secret-store blip). Don't treat
    // that as "disconnected" — leave any existing schedule untouched rather than
    // cancelling a connected tenant's cycle. The next convergence retries.
    logger.warn('[accountingSync] Realm check failed; leaving schedule unchanged', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }

  if (!hasRealm) {
    await cancelAccountingSyncCycle(tenantId, singletonKey);
    return null;
  }

  try {
    const runner = await getJobRunner();
    const result = await runner.scheduleRecurringJob<AccountingSyncCycleJobData>(
      JOB_NAME,
      { tenantId },
      CYCLE_CRON,
      { singletonKey }
    );
    return result.jobId;
  } catch (error) {
    // "already exists" style errors are routine on startup re-registration.
    logger.info('[accountingSync] Cycle schedule registration skipped', {
      tenantId,
      error: error instanceof Error ? error.message : error
    });
    return null;
  }
}
