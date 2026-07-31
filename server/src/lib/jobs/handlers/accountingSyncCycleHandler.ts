import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getJobRunner } from '../JobRunnerFactory';
import type { BaseJobData } from '../interfaces';
import {
  runAccountingSyncCycle,
  AccountingAdapterRegistry,
  resolveConnectedAccountingIntegration
} from '@alga-psa/billing/services';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';

export interface AccountingSyncCycleJobData extends BaseJobData {
  tenantId: string;
}

const JOB_NAME = 'accounting-sync-cycle';
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

  const knex = await getConnection(tenantId);
  const integration = await resolveConnectedAccountingIntegration(knex, tenantId);
  if (!integration) {
    return; // cycle guard: no connection, nothing to do
  }

  const registry = await AccountingAdapterRegistry.createDefault();
  const adapter = registry.get(integration.adapterType);
  if (!adapter) {
    logger.warn('[accountingSync] No adapter registered for scheduled cycle', {
      tenantId,
      adapterType: integration.adapterType
    });
    return;
  }

  const targets =
    integration.adapterType === 'quickbooks_online'
      ? Object.entries(await getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, any>))).map(
          ([targetRealm, credentials]) => ({
            targetRealm,
            refreshTokenExpiresAt: (credentials as any)?.refreshTokenExpiresAt ?? null
          })
        )
      : [{
          targetRealm: integration.targetRealm,
          refreshTokenExpiresAt:
            (await getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, any>)))[integration.targetRealm]
              ?.refreshTokenExpiresAt ?? null
        }];

  if (targets.length === 0) {
    return;
  }

  await runWithTenant(tenantId, async () => {
    for (const target of targets) {
      try {
        const result = await runAccountingSyncCycle({
          knex,
          tenantId,
          adapterType: integration.adapterType,
          targetRealm: target.targetRealm,
          adapter,
          refreshTokenExpiresAt: target.refreshTokenExpiresAt
        });
        if (result.ran) {
          logger.info('[accountingSync] Scheduled cycle finished', {
            tenantId,
            realm: target.targetRealm,
            status: result.status,
            stats: result.stats
          });
        }
      } catch (error) {
        logger.error('[accountingSync] Scheduled cycle crashed', {
          tenantId,
          realm: target.targetRealm,
          error: error instanceof Error ? error.message : error
        });
      }
    }
  });
}

// Throws if credentials can't be read (e.g. a transient secret-store error) so
// the caller can distinguish "genuinely disconnected" from "couldn't tell" — the
// latter must NOT cancel a connected tenant's schedule.
async function tenantHasConnectedAccountingIntegration(tenantId: string): Promise<boolean> {
  const adminKnex = await getAdminConnection();
  const integration = await resolveConnectedAccountingIntegration(adminKnex, tenantId);
  return integration !== null;
}

async function cancelAccountingSyncCycle(tenantId: string, singletonKey: string): Promise<void> {
  const adminKnex = await getAdminConnection();
  const existing = await tenantDb(adminKnex, tenantId).table('jobs')
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

  let hasIntegration: boolean;
  try {
    hasIntegration = await tenantHasConnectedAccountingIntegration(tenantId);
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

  if (!hasIntegration) {
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
