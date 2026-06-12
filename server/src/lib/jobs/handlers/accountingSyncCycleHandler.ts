import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
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
 * cycle per realm. The cycle is scheduled for every tenant (like the other
 * per-tenant jobs); unconnected/CE/auto-sync-off tenants no-op cheaply inside
 * the guard, which is what makes connect/disconnect registration unnecessary.
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

/**
 * Register the recurring 15-minute cycle for a tenant via the IJobRunner
 * abstraction (pg-boss cron schedule or Temporal schedule). Idempotent —
 * existing schedules are left in place.
 */
export async function scheduleAccountingSyncCycleJob(tenantId: string): Promise<string | null> {
  if (!isEnterpriseEdition()) {
    return null;
  }

  try {
    const runner = await getJobRunner();
    const result = await runner.scheduleRecurringJob<AccountingSyncCycleJobData>(
      JOB_NAME,
      { tenantId },
      CYCLE_CRON,
      { singletonKey: `${JOB_NAME}:${tenantId}` }
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
