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

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  getRmmAlertFetcher,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
} from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { tacticalRmmAlertFetcher } from '@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher';
import type { Knex } from 'knex';
import type { IJobRunner } from '../jobs/interfaces';

export const RMM_ALERT_RECONCILIATION_JOB = 'rmm-alert-reconciliation';
export const HUNTRESS_INCIDENT_POLL_JOB = 'huntress-incident-poll';
export const RMM_DEVICE_SYNC_JOB = 'rmm-device-sync';

const RMM_ALERT_POLLING_PROVIDERS = ['ninjaone', 'tacticalrmm'];

/**
 * Which providers get a recurring device sync. Deliberately NOT the alert
 * polling list: the two capabilities do not coincide. Level.io syncs devices
 * but polls no alerts; Huntress polls incidents but has no proven device sync
 * path. A provider only belongs here once a manual sync is known to work for
 * it — scheduling a broken path just manufactures recurring failures.
 */
const RMM_DEVICE_SYNC_PROVIDERS = ['ninjaone', 'levelio'];

/** Device syncs are far heavier than alert polls, so the floor is higher. */
const DEVICE_SYNC_MIN_MINUTES = 15;
const DEVICE_SYNC_MAX_MINUTES = 1440;
const DEVICE_SYNC_DEFAULT_MINUTES = 60;
const RMM_POLLING_RECONCILE_TENANT = '__rmm_polling_reconcile__';
const RMM_POLLING_RECONCILE_REASON = 'RMM polling reconciler scans integration schedules across tenants';

export interface RmmAlertReconciliationJobData extends Record<string, unknown> {
  tenantId: string;
  integrationId: string;
  provider: string;
}

export interface HuntressIncidentPollJobData extends Record<string, unknown> {
  tenantId: string;
  integrationId: string;
}

export interface RmmDeviceSyncJobData extends Record<string, unknown> {
  tenantId: string;
  integrationId: string;
  provider: string;
}

function tenantScopedTable(knex: Knex, table: string, tenant: string) {
  return tenantDb(knex, tenant).table(table);
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

/**
 * Device-sync desired state. Defaults to DISABLED: enabling a recurring provider
 * API load is an opt-in, so an integration that has never been configured must
 * not acquire a schedule on upgrade.
 */
export function parseRmmDeviceSyncState(row: { is_active: boolean; settings: unknown }): IntegrationPollState {
  const settings = typeof row.settings === 'string' ? safeParse(row.settings) : (row.settings ?? {});
  const deviceSync = ((settings as Record<string, unknown>).deviceSync ?? {}) as Record<string, unknown>;
  const rawInterval = Number(deviceSync.intervalMinutes);
  return {
    active: Boolean(row.is_active),
    pollingEnabled: deviceSync.enabled === true,
    intervalMinutes: Number.isFinite(rawInterval)
      ? Math.min(DEVICE_SYNC_MAX_MINUTES, Math.max(DEVICE_SYNC_MIN_MINUTES, Math.round(rawInterval)))
      : DEVICE_SYNC_DEFAULT_MINUTES,
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
  const row = await tenantScopedTable(adminKnex, 'rmm_integrations', data.tenantId)
    .where({ integration_id: data.integrationId })
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
  const row = await tenantScopedTable(adminKnex, 'rmm_integrations', data.tenantId)
    .where({ integration_id: data.integrationId, is_active: true })
    .first('integration_id');
  if (!row) {
    logger.info('[HuntressIncidentPollJob] Skipping: integration inactive', data);
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
  const query = tenantScopedTable(adminKnex, 'jobs', tenantId)
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
  return (row as unknown as ExistingRecurringJob | undefined) ?? null;
}

interface ReconcileArgs {
  tenantId: string;
  integrationId: string;
  provider: string;
  row: { is_active: boolean; settings: unknown; tenant_suspended_at?: unknown };
}

interface ReconcileOutcome {
  ensured: number;
  cancelled: number;
}

/**
 * Converge one integration's alert-polling schedule. Behaviour is unchanged
 * from when this lived inline in the reconciler loop; it is a function so that
 * device sync can be reconciled independently of its early exits.
 */
async function reconcileAlertScheduleForIntegration(
  runner: IJobRunner,
  adminKnex: Knex,
  { tenantId, integrationId, provider, row }: ReconcileArgs
): Promise<ReconcileOutcome> {
  const isHuntress = provider === 'huntress';
  const jobName = isHuntress ? HUNTRESS_INCIDENT_POLL_JOB : RMM_ALERT_RECONCILIATION_JOB;
  const singletonKey = `${jobName}:${tenantId}:${integrationId}`;
  const state = isHuntress ? parseHuntressPollState(row) : parseRmmPollState(row);
  // Suspended tenants are ineligible, so the control loop cancels their
  // polls and recreates them automatically once the suspension clears.
  const eligible =
    state.active
    && state.pollingEnabled
    && !row.tenant_suspended_at
    && (isHuntress || Boolean(getRmmAlertFetcher(provider)));
  const desiredCron = intervalMinutesToCron(state.intervalMinutes);

  const data = isHuntress
    ? ({ tenantId, integrationId } satisfies HuntressIncidentPollJobData)
    : ({ tenantId, integrationId, provider } satisfies RmmAlertReconciliationJobData);

  return convergeSchedule(runner, adminKnex, {
    tenantId,
    integrationId,
    provider,
    jobName,
    singletonKey,
    eligible,
    desiredCron,
    data,
  });
}

/**
 * Converge one integration's device-sync schedule. Eligibility is deliberately
 * narrower than the alert path: the provider must be on the device-sync list
 * AND deviceSync.enabled must be explicitly true, so nothing acquires a
 * recurring provider API load by default.
 */
async function reconcileDeviceSyncForIntegration(
  runner: IJobRunner,
  adminKnex: Knex,
  { tenantId, integrationId, provider, row }: ReconcileArgs
): Promise<ReconcileOutcome> {
  const singletonKey = `${RMM_DEVICE_SYNC_JOB}:${tenantId}:${integrationId}`;
  const state = parseRmmDeviceSyncState(row);
  const eligible =
    state.active
    && state.pollingEnabled
    && !row.tenant_suspended_at
    && RMM_DEVICE_SYNC_PROVIDERS.includes(provider);
  const desiredCron = intervalMinutesToCron(state.intervalMinutes);

  return convergeSchedule(runner, adminKnex, {
    tenantId,
    integrationId,
    provider,
    jobName: RMM_DEVICE_SYNC_JOB,
    singletonKey,
    eligible,
    desiredCron,
    data: { tenantId, integrationId, provider } satisfies RmmDeviceSyncJobData,
  });
}

/**
 * The create/recreate/cancel decision, shared by both capabilities. Errors are
 * caught per schedule so one bad integration cannot abort the whole pass.
 */
async function convergeSchedule(
  runner: IJobRunner,
  adminKnex: Knex,
  args: {
    tenantId: string;
    integrationId: string;
    provider: string;
    jobName: string;
    singletonKey: string;
    eligible: boolean;
    desiredCron: string;
    data: RmmAlertReconciliationJobData | HuntressIncidentPollJobData | RmmDeviceSyncJobData;
  }
): Promise<ReconcileOutcome> {
  const { tenantId, integrationId, provider, jobName, singletonKey, eligible, desiredCron, data } = args;
  let ensured = 0;
  let cancelled = 0;

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
      return { ensured, cancelled };
    }

    if (existing && existing.interval === desiredCron) {
      return { ensured, cancelled }; // converged
    }
    if (existing) {
      // Interval changed: recreate (neither backend mutates args in place).
      await runner.cancelJob(existing.job_id, tenantId);
      cancelled += 1;
    }

    await runner.scheduleRecurringJob(jobName, data, desiredCron, { singletonKey });
    ensured += 1;
  } catch (error) {
    logger.warn('[RmmPollingReconciler] Failed to reconcile schedule', {
      tenantId,
      integrationId,
      provider,
      jobName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ensured, cancelled };
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
  const integrations = await tenantDb(adminKnex, RMM_POLLING_RECONCILE_TENANT)
    .unscoped('rmm_integrations', RMM_POLLING_RECONCILE_REASON)
    .join('tenants as t', 'rmm_integrations.tenant', 't.tenant')
    .whereIn('provider', [
      ...new Set([...RMM_ALERT_POLLING_PROVIDERS, 'huntress', ...RMM_DEVICE_SYNC_PROVIDERS]),
    ])
    .select(
      'rmm_integrations.tenant',
      'rmm_integrations.integration_id',
      'rmm_integrations.provider',
      'rmm_integrations.is_active',
      'rmm_integrations.settings',
      't.suspended_at as tenant_suspended_at'
    );

  let ensured = 0;
  let cancelled = 0;

  for (const row of integrations) {
    const tenantId = String(row.tenant);
    const integrationId = String(row.integration_id);
    const provider = String(row.provider);

    // Alerts and device sync are independent capabilities on the same
    // integration: a provider may have one, the other, or both. Each is
    // reconciled on its own so an ineligible alert poll cannot suppress a
    // device sync (or vice versa).
    for (const outcome of [
      await reconcileAlertScheduleForIntegration(runner, adminKnex, { tenantId, integrationId, provider, row }),
      await reconcileDeviceSyncForIntegration(runner, adminKnex, { tenantId, integrationId, provider, row }),
    ]) {
      ensured += outcome.ensured;
      cancelled += outcome.cancelled;
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
