/**
 * RMM polling on the IJobRunner abstraction — a worked example of how
 * recurring scheduling works in Alga:
 *
 * - Handlers are registered once in the central JobHandlerRegistry
 *   (registerAllHandlers.ts). The same handler code runs on whichever backend
 *   JobRunnerFactory selects: PgBossJobRunner in CE, TemporalJobRunner in EE
 *   (override with JOB_RUNNER_TYPE). The Temporal worker additionally loads
 *   handlers it should execute in initializeJobHandlersForWorker()
 *   (ee/temporal-workflows/src/activities/job-activities.ts).
 * - Recurring work = one IJobRunner recurring job per RMM integration, keyed
 *   by singletonKey `<job>:<tenant>:<integration>` with a cron interval. On
 *   pg-boss that is a real cron schedule; on Temporal a Temporal Schedule
 *   driving genericJobWorkflow.
 * - Desired state lives in rmm_integrations (is_active + settings).
 *   reconcileRmmPollingSchedules() diffs it against the jobs table and
 *   creates/recreates/cancels jobs to match. It runs every few minutes from
 *   initializeApp plus immediately from connect/disconnect flows, so settings
 *   changes converge without operator intervention. Handlers also re-check
 *   eligibility per run, so a schedule that outlives its integration between
 *   reconciliations is a harmless no-op.
 *
 * EE-only pieces (the NinjaOne fetcher, the Huntress poller) are reached via
 * dynamic @enterprise imports, which resolve to CE stubs in community builds.
 */

import { isFeatureFlagEnabled } from '@alga-psa/core';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { createTenantKnex } from '@alga-psa/db';
import {
  getRmmAlertFetcher,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
} from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { tacticalRmmAlertFetcher } from '@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher';
import type { IJobRunner } from '../interfaces';

export const RMM_ALERT_RECONCILIATION_JOB = 'rmm-alert-reconciliation';
export const HUNTRESS_INCIDENT_POLL_JOB = 'huntress-incident-poll';

const HUNTRESS_FEATURE_FLAG = 'huntress-rmm-integration';

const RMM_ALERT_POLLING_PROVIDERS = ['ninjaone', 'tacticalrmm'];

export interface RmmAlertReconciliationJobData extends Record<string, unknown> {
  tenantId: string;
  integrationId: string;
  provider: string;
}

export interface HuntressIncidentPollJobData extends Record<string, unknown> {
  tenantId: string;
  integrationId: string;
}

let fetchersEnsured = false;
async function ensureFetchersRegistered(): Promise<void> {
  if (fetchersEnsured) return;
  registerRmmAlertFetcher('tacticalrmm', tacticalRmmAlertFetcher);
  try {
    // Real fetcher in EE builds; the CE stub exports undefined.
    const mod = await import('@enterprise/lib/integrations/ninjaone/alerts/reconciliationFetcher');
    if (mod.ninjaOneAlertFetcher) {
      registerRmmAlertFetcher('ninjaone', mod.ninjaOneAlertFetcher);
    }
  } catch {
    // CE build without the alias target — NinjaOne polling simply unavailable.
  }
  fetchersEnsured = true;
}

interface IntegrationPollState {
  active: boolean;
  pollingEnabled: boolean;
  intervalMinutes: number;
}

function parseRmmPollState(row: { is_active: boolean; settings: unknown }): IntegrationPollState {
  const settings = typeof row.settings === 'string' ? safeParse(row.settings) : (row.settings ?? {});
  const polling = ((settings as Record<string, unknown>).alertPolling ?? {}) as Record<string, unknown>;
  const rawInterval = Number(polling.intervalMinutes);
  return {
    active: Boolean(row.is_active),
    pollingEnabled: polling.enabled !== false,
    intervalMinutes: Number.isFinite(rawInterval) ? Math.min(60, Math.max(5, Math.round(rawInterval))) : 15,
  };
}

function parseHuntressPollState(row: { is_active: boolean; settings: unknown }): IntegrationPollState {
  const settings = typeof row.settings === 'string' ? safeParse(row.settings) : (row.settings ?? {});
  const rawInterval = Number((settings as Record<string, unknown>).pollIntervalMinutes);
  return {
    active: Boolean(row.is_active),
    pollingEnabled: true,
    intervalMinutes: Number.isFinite(rawInterval) ? Math.min(1440, Math.max(5, Math.round(rawInterval))) : 5,
  };
}

/** Both backends take cron for recurring jobs; minutes-based cadences map cleanly. */
export function intervalMinutesToCron(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.max(1, Math.round(minutes / 60));
    return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

export async function rmmAlertReconciliationHandler(
  _jobId: string,
  data: RmmAlertReconciliationJobData
): Promise<void> {
  await ensureFetchersRegistered();

  const adminKnex = await getAdminConnection();
  const row = await adminKnex('rmm_integrations')
    .where({ tenant: data.tenantId, integration_id: data.integrationId })
    .first('is_active', 'settings');
  const state = row ? parseRmmPollState(row) : null;
  if (!state?.active || !state.pollingEnabled) {
    logger.info('[RmmAlertReconciliationJob] Skipping: integration inactive or polling disabled', data);
    return;
  }
  if (!getRmmAlertFetcher(data.provider)) {
    logger.warn('[RmmAlertReconciliationJob] No fetcher for provider; skipping', data);
    return;
  }

  // Job handlers already run inside the tenant context (both runners wrap
  // execution in runWithTenant).
  const { knex } = await createTenantKnex();
  const result = await runRmmAlertReconciliation(
    { knex, deps: buildRmmAlertPipelineDeps() },
    { tenantId: data.tenantId, integrationId: data.integrationId, provider: data.provider }
  );
  for (const warning of result.warnings) {
    logger.warn('[RmmAlertReconciliationJob] warning', { ...data, warning });
  }
  logger.info('[RmmAlertReconciliationJob] cycle complete', {
    ...data,
    remoteActive: result.remoteActive,
    ingested: result.ingested,
    resetsSynthesized: result.resetsSynthesized,
  });
}

export async function huntressIncidentPollHandler(
  _jobId: string,
  data: HuntressIncidentPollJobData
): Promise<void> {
  const adminKnex = await getAdminConnection();
  const row = await adminKnex('rmm_integrations')
    .where({ tenant: data.tenantId, integration_id: data.integrationId, is_active: true })
    .first('integration_id');
  if (!row) {
    logger.info('[HuntressIncidentPollJob] Skipping: integration inactive', data);
    return;
  }

  // Ported from the deleted huntress/scheduling.ts dispatcher: scheduled
  // polls skip tenants without the Huntress feature flag.
  const flagEnabled = await isFeatureFlagEnabled(HUNTRESS_FEATURE_FLAG, {
    tenantId: data.tenantId,
  });
  if (!flagEnabled) {
    logger.info('[HuntressIncidentPollJob] Skipping: feature flag disabled', data);
    return;
  }

  // Real poller in EE builds; the CE stub exports undefined (Huntress is
  // EE-only, so this job is never scheduled in CE anyway).
  const mod = await import('@enterprise/lib/integrations/huntress/incidents/incidentPoller');
  if (!mod.runHuntressIncidentPoll) {
    logger.warn('[HuntressIncidentPollJob] Huntress poller unavailable in this edition', data);
    return;
  }
  await mod.runHuntressIncidentPoll({
    tenantId: data.tenantId,
    integrationId: data.integrationId,
    trigger: 'scheduled',
  });
}

interface ExistingRecurringJob {
  job_id: string;
  tenant: string;
  interval: string | null;
}

async function findExistingRecurringJob(
  adminKnex: Awaited<ReturnType<typeof getAdminConnection>>,
  tenantId: string,
  singletonKey: string,
  options?: { anyStatus?: boolean }
): Promise<ExistingRecurringJob | null> {
  const query = adminKnex('jobs')
    .where({ tenant: tenantId })
    .whereRaw(`metadata->>'singletonKey' = ?`, [singletonKey])
    .whereRaw(`metadata->>'recurring' = 'true'`)
    // external_id is the live schedule pointer; cancelJob nulls it on teardown.
    .whereNotNull('external_id')
    .orderBy('created_at', 'desc')
    .first('job_id', 'tenant', adminKnex.raw(`metadata->>'interval' as interval`));
  if (!options?.anyStatus) {
    query.whereNotIn('status', ['failed', 'completed']);
  }
  const row = await query;
  return (row as ExistingRecurringJob | undefined) ?? null;
}

/**
 * Control loop: converge per-integration polling jobs onto the desired state
 * in rmm_integrations. Safe to run from anywhere, any time — operations are
 * keyed by singletonKey and only touch jobs whose desired state changed.
 */
export async function reconcileRmmPollingSchedules(
  runner: IJobRunner
): Promise<{ ensured: number; cancelled: number }> {
  await ensureFetchersRegistered();
  const adminKnex = await getAdminConnection();
  const integrations = await adminKnex('rmm_integrations')
    .whereIn('provider', [...RMM_ALERT_POLLING_PROVIDERS, 'huntress'])
    .select('tenant', 'integration_id', 'provider', 'is_active', 'settings');

  let ensured = 0;
  let cancelled = 0;

  for (const row of integrations) {
    const tenantId = String(row.tenant);
    const integrationId = String(row.integration_id);
    const provider = String(row.provider);
    const isHuntress = provider === 'huntress';

    const jobName = isHuntress ? HUNTRESS_INCIDENT_POLL_JOB : RMM_ALERT_RECONCILIATION_JOB;
    const singletonKey = `${jobName}:${tenantId}:${integrationId}`;
    const state = isHuntress ? parseHuntressPollState(row) : parseRmmPollState(row);
    const eligible =
      state.active && state.pollingEnabled && (isHuntress || Boolean(getRmmAlertFetcher(provider)));
    const desiredCron = intervalMinutesToCron(state.intervalMinutes);

    try {
      const existing = await findExistingRecurringJob(adminKnex, tenantId, singletonKey);

      if (!eligible) {
        // Cancel via the newest record of ANY status: a failed last run must
        // not strand the underlying schedule (cancelJob unschedules
        // recurring records regardless of run status; repeat cancels no-op).
        const candidate =
          existing ?? (await findExistingRecurringJob(adminKnex, tenantId, singletonKey, { anyStatus: true }));
        if (candidate) {
          const didCancel = await runner.cancelJob(candidate.job_id, tenantId);
          if (didCancel) cancelled += 1;
        }
        continue;
      }

      if (existing && existing.interval === desiredCron) {
        continue; // converged
      }
      if (existing) {
        // Interval changed: recreate (neither backend mutates args in place).
        await runner.cancelJob(existing.job_id, tenantId);
        cancelled += 1;
      }

      const data = isHuntress
        ? ({ tenantId, integrationId } satisfies HuntressIncidentPollJobData)
        : ({ tenantId, integrationId, provider } satisfies RmmAlertReconciliationJobData);
      await runner.scheduleRecurringJob(jobName, data, desiredCron, { singletonKey });
      ensured += 1;
    } catch (error) {
      logger.warn('[RmmPollingReconciler] Failed to reconcile integration', {
        tenantId,
        integrationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (ensured || cancelled) {
    logger.info('[RmmPollingReconciler] converged', { integrations: integrations.length, ensured, cancelled });
  }
  return { ensured, cancelled };
}

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
