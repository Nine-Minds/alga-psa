/**
 * RMM alert reconciliation dispatcher: a single recurring pg-boss job that
 * iterates active RMM integrations with a registered alert fetcher and runs a
 * reconciliation cycle for the ones whose per-tenant interval has elapsed.
 * Mirrors the Huntress incident poll dispatcher; registered from
 * initializeApp in enterprise builds.
 */

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { runWithTenant, createTenantKnex } from '@/lib/db';
import type { IJobScheduler } from 'server/src/lib/jobs/jobScheduler';
import {
  getRmmAlertFetcher,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
} from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { ninjaOneAlertFetcher } from '../ninjaone/alerts/reconciliationFetcher';

export const RMM_ALERT_RECONCILIATION_JOB_NAME = 'rmm-alert-reconciliation-dispatch';
const DISPATCH_INTERVAL = process.env.RMM_ALERT_RECONCILIATION_DISPATCH_INTERVAL || '5 minutes';

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 60;

interface AlertPollingSettings {
  enabled: boolean;
  intervalMinutes: number;
  lastPolledAt: string | null;
}

export function parseAlertPollingSettings(rawSettings: unknown): AlertPollingSettings {
  const settings =
    typeof rawSettings === 'string' ? safeParse(rawSettings) : (rawSettings as Record<string, unknown> | null);
  const polling =
    settings && typeof settings === 'object'
      ? ((settings as Record<string, unknown>).alertPolling as Record<string, unknown> | undefined)
      : undefined;

  const rawInterval = Number(polling?.intervalMinutes);
  const intervalMinutes = Number.isFinite(rawInterval)
    ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(rawInterval)))
    : DEFAULT_INTERVAL_MINUTES;

  return {
    enabled: polling?.enabled !== false,
    intervalMinutes,
    lastPolledAt: typeof polling?.lastPolledAt === 'string' ? polling.lastPolledAt : null,
  };
}

export function isReconciliationDue(settings: AlertPollingSettings, now: Date): boolean {
  if (!settings.enabled) return false;
  if (!settings.lastPolledAt) return true;
  const last = new Date(settings.lastPolledAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= settings.intervalMinutes * 60_000;
}

export async function dispatchRmmAlertReconciliation(now: Date = new Date()): Promise<void> {
  ensureFetchersRegistered();

  const adminKnex = await getAdminConnection();
  const integrations = await adminKnex('rmm_integrations')
    .where({ is_active: true })
    .select('tenant', 'integration_id', 'provider', 'settings');

  for (const row of integrations) {
    if (!getRmmAlertFetcher(String(row.provider))) continue;
    const settings = parseAlertPollingSettings(row.settings);
    if (!isReconciliationDue(settings, now)) continue;

    try {
      await runWithTenant(String(row.tenant), async () => {
        const { knex } = await createTenantKnex();
        const result = await runRmmAlertReconciliation(
          { knex, deps: buildRmmAlertPipelineDeps() },
          {
            tenantId: String(row.tenant),
            integrationId: String(row.integration_id),
            provider: String(row.provider),
          }
        );
        for (const warning of result.warnings) {
          logger.warn('[RmmAlertReconciliation] warning', { tenant: row.tenant, warning });
        }
        logger.info('[RmmAlertReconciliation] cycle complete', {
          tenant: row.tenant,
          provider: row.provider,
          remoteActive: result.remoteActive,
          ingested: result.ingested,
          resetsSynthesized: result.resetsSynthesized,
        });
      });
    } catch (error) {
      // One tenant's failure must never block the others.
      logger.error('[RmmAlertReconciliation] cycle failed', { tenant: row.tenant, error });
    }

    try {
      await adminKnex('rmm_integrations')
        .where({ tenant: row.tenant, integration_id: row.integration_id })
        .update({
          settings: adminKnex.raw(
            `jsonb_set(COALESCE(settings, '{}'::jsonb), '{alertPolling,lastPolledAt}', to_jsonb(?::text), true)`,
            [now.toISOString()]
          ),
        });
    } catch (error) {
      logger.warn('[RmmAlertReconciliation] failed to stamp lastPolledAt', { tenant: row.tenant, error });
    }
  }
}

let fetchersRegistered = false;
function ensureFetchersRegistered(): void {
  if (fetchersRegistered) return;
  registerRmmAlertFetcher('ninjaone', ninjaOneAlertFetcher);
  // TacticalRMM/Level fetchers land once their list-alerts API shapes are
  // verified against live instances; until then those providers stay
  // webhook-only and the dispatcher skips them.
  fetchersRegistered = true;
}

export async function registerRmmAlertReconciliation(jobScheduler: IJobScheduler): Promise<void> {
  ensureFetchersRegistered();
  jobScheduler.registerJobHandler<{ tenantId: string }>(RMM_ALERT_RECONCILIATION_JOB_NAME, async () => {
    try {
      await dispatchRmmAlertReconciliation();
    } finally {
      await jobScheduler.scheduleRecurringJob(RMM_ALERT_RECONCILIATION_JOB_NAME, DISPATCH_INTERVAL, {
        tenantId: 'system',
      });
    }
  });

  await jobScheduler.scheduleRecurringJob(RMM_ALERT_RECONCILIATION_JOB_NAME, DISPATCH_INTERVAL, {
    tenantId: 'system',
  });
  logger.info('[RmmAlertReconciliation] dispatcher registered');
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
