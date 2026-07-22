import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import { createLogger, format, transports } from 'winston';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { ADD_ONS } from '@alga-psa/types';
import { seedNinjaOneProactiveRefreshFromStoredCredentials } from '@ee/lib/integrations/ninjaone/proactiveRefresh';
import {
  applianceCheckInWorkflow,
  calendarWebhookMaintenanceWorkflow,
  emailWebhookMaintenanceWorkflow,
  emailPollingReconcileWorkflow,
  entraAllTenantsSyncWorkflow,
  maintenanceJobWorkflow,
  premiumTrialExpiryWorkflow,
} from '../workflows';
import * as dotenv from 'dotenv';

dotenv.config();

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});

const EMAIL_WORKFLOW_TASK_QUEUE = 'email-domain-workflows';
const ENTRA_WORKFLOW_TASK_QUEUE = 'tenant-workflows';
const ENTRA_SCHEDULE_ID_PREFIX = 'entra-all-tenants-sync-schedule';
const ENTRA_SCHEDULE_DISCOVERY_TENANT = '__entra_schedule_config_discovery__';
// Note: RMM alert reconciliation and Huntress incident polling are NOT set up
// here. They run as per-integration recurring jobs on the job-runner
// abstraction (Temporal Schedules in EE via TemporalJobRunner), converged by
// the reconciler in server/src/lib/jobs/handlers/rmmAlertPollingHandlers.ts.

interface EntraScheduleConfigRow {
  tenantId: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  hasActiveConnection: boolean;
  hasEnterpriseAddOn: boolean;
}

interface NinjaOneBackfillRow {
  tenantId: string;
  integrationId: string;
  settings: unknown;
}

function isAlreadyExistsError(error: any): boolean {
  return Boolean(
    error?.code === 6 || error?.name === 'ScheduleAlreadyRunning' || error?.message?.includes('AlreadyExists')
  );
}

function isNotFoundError(error: any): boolean {
  return Boolean(error?.code === 5 || error?.name === 'NotFoundError' || error?.message?.includes('NotFound'));
}

function normalizeIntervalMinutes(rawValue: unknown): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1440;
  }

  return Math.max(5, Math.floor(parsed));
}

function microsoftEmailPollingIntervalMinutes(): number {
  const parsed = Number(process.env.MICROSOFT_EMAIL_POLLING_INTERVAL_MINUTES || 3);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignored
    }
  }
  return {};
}

async function loadNinjaOneBackfillCandidates(): Promise<NinjaOneBackfillRow[]> {
  const knex = await getAdminConnection();
  const rows = await tenantDb(knex, '__ninjaone_backfill_integration_discovery__')
    .unscoped(
      'rmm_integrations',
      'NinjaOne proactive refresh backfill enumerates active integrations before tenant context is known'
    )
    .where({ provider: 'ninjaone', is_active: true })
    .select([
      'tenant as tenantId',
      'integration_id as integrationId',
      'settings',
    ]);

  return rows.map((row: any) => ({
    tenantId: String(row.tenantId),
    integrationId: String(row.integrationId),
    settings: row.settings,
  }));
}

function shouldBackfillNinjaOneIntegration(row: NinjaOneBackfillRow): boolean {
  const settings = parseSettings(row.settings);
  const lifecycle = (settings.tokenLifecycle || {}) as {
    reconnectRequired?: boolean;
  };

  if (lifecycle.reconnectRequired) {
    return false;
  }

  return true;
}

async function backfillNinjaOneProactiveSchedules(): Promise<void> {
  const rows = await loadNinjaOneBackfillCandidates();
  if (rows.length === 0) {
    return;
  }

  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!shouldBackfillNinjaOneIntegration(row)) {
      skipped++;
      continue;
    }

    try {
      const result = await seedNinjaOneProactiveRefreshFromStoredCredentials({
        tenantId: row.tenantId,
        integrationId: row.integrationId,
        source: 'backfill',
      });

      if (result.scheduled) {
        seeded++;
      } else {
        skipped++;
      }
    } catch (error: any) {
      failed++;
      logger.warn('Failed NinjaOne proactive refresh backfill for integration', {
        tenantId: row.tenantId,
        integrationId: row.integrationId,
        error: error?.message || 'Unknown error',
      });
    }
  }

  logger.info('NinjaOne proactive refresh backfill completed', {
    total: rows.length,
    seeded,
    skipped,
    failed,
  });
}

async function upsertSchedule(client: Client, scheduleId: string, input: any): Promise<void> {
  try {
    await client.schedule.create({
      scheduleId,
      spec: input.spec,
      action: input.action,
      policies: input.policies,
    } as any);
    logger.info(`Successfully created schedule: ${scheduleId}`);
  } catch (error: any) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    logger.info(`Schedule ${scheduleId} already exists. Updating configuration...`);
    const handle = client.schedule.getHandle(scheduleId);
    await handle.update((prev) => ({
      ...prev,
      spec: input.spec,
      action: input.action,
      policies: input.policies,
    }));
    logger.info(`Successfully updated schedule: ${scheduleId}`);
  }
}

async function deleteScheduleIfExists(client: Client, scheduleId: string): Promise<void> {
  try {
    const handle = client.schedule.getHandle(scheduleId);
    await handle.delete();
    logger.info(`Deleted schedule: ${scheduleId}`);
  } catch (error: any) {
    if (isNotFoundError(error)) {
      return;
    }
    logger.warn(`Failed to delete schedule ${scheduleId}: ${error?.message || 'Unknown error'}`);
  }
}

async function loadEntraScheduleConfigs(): Promise<EntraScheduleConfigRow[]> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, ENTRA_SCHEDULE_DISCOVERY_TENANT);
  const query = db
    .unscoped(
      'entra_sync_settings as s',
      'Temporal schedule setup enumerates Entra sync settings across tenants'
    );

  db.tenantJoin(query, 'entra_partner_connections as c', 's.tenant', 'c.tenant', {
    type: 'left',
    on: (join) => {
      join.andOn(knex.raw('c.is_active = true'));
    },
  });
  db.tenantJoin(query, 'tenant_addons as a', 's.tenant', 'a.tenant', {
    type: 'left',
    on: (join) => {
      join
        .andOn(knex.raw('a.addon_key = ?', [ADD_ONS.ENTERPRISE]))
        .andOn(knex.raw('(a.expires_at IS NULL OR a.expires_at > now())'));
    },
  });

  const rows = await query
    .select([
      's.tenant as tenantId',
      's.sync_enabled as syncEnabled',
      's.sync_interval_minutes as syncIntervalMinutes',
      'c.connection_id as activeConnectionId',
      'a.addon_key as activeEnterpriseAddOn',
    ]);

  return rows.map((row: any) => ({
    tenantId: String(row.tenantId),
    syncEnabled: Boolean(row.syncEnabled),
    syncIntervalMinutes: normalizeIntervalMinutes(row.syncIntervalMinutes),
    hasActiveConnection: Boolean(row.activeConnectionId),
    hasEnterpriseAddOn: Boolean(row.activeEnterpriseAddOn),
  }));
}

export async function setupSchedules() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'default';

  logger.info('Initializing Temporal Schedules...', { temporalAddress, temporalNamespace });

  try {
    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });

    const scheduleId = 'email-webhook-maintenance-schedule';

    await upsertSchedule(client, scheduleId, {
      spec: {
        intervals: [{ every: '15m' }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: emailWebhookMaintenanceWorkflow,
        args: [{ lookAheadMinutes: 1440 }],
        taskQueue: EMAIL_WORKFLOW_TASK_QUEUE,
        workflowExecutionTimeout: '10m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1m',
      },
    });

    const pollingScheduleId = 'email-polling-reconcile-schedule';
    await upsertSchedule(client, pollingScheduleId, {
      spec: {
        intervals: [{ every: `${microsoftEmailPollingIntervalMinutes()}m` }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: emailPollingReconcileWorkflow,
        args: [{}],
        taskQueue: EMAIL_WORKFLOW_TASK_QUEUE,
        workflowExecutionTimeout: '10m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1m',
      },
    });

    // Calendar webhook maintenance schedule (runs every 30 minutes, checks 3 hours ahead)
    const calendarScheduleId = 'calendar-webhook-maintenance-schedule';
    await upsertSchedule(client, calendarScheduleId, {
      spec: {
        intervals: [{ every: '30m' }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: calendarWebhookMaintenanceWorkflow,
        args: [{ lookAheadMinutes: 180 }],
        taskQueue: EMAIL_WORKFLOW_TASK_QUEUE,
        workflowExecutionTimeout: '10m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1m',
      },
    });

    // Premium trial expiry check (runs daily, reverts expired trials to Pro)
    const premiumTrialScheduleId = 'premium-trial-expiry-schedule';
    await upsertSchedule(client, premiumTrialScheduleId, {
      spec: {
        intervals: [{ every: '24h' }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: premiumTrialExpiryWorkflow,
        args: [],
        taskQueue: 'tenant-workflows',
        workflowExecutionTimeout: '10m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1m',
      },
    });

    // Appliance connected-license check-in (runs daily). Renews this install's
    // connected license token before its ~31-day exp by calling the
    // alga-license /check-in endpoint, and propagates soft-revocation. No-ops on
    // SaaS/cloud (no license_state row) and on non-connected installs
    // (essentials/airgap/CE/trial). Mirrors the premium-trial daily maintenance.
    const applianceCheckInScheduleId = 'appliance-license-check-in-schedule';
    await upsertSchedule(client, applianceCheckInScheduleId, {
      spec: {
        intervals: [{ every: '24h' }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: applianceCheckInWorkflow,
        args: [],
        taskQueue: 'tenant-workflows',
        workflowExecutionTimeout: '10m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1m',
      },
    });

    // Trigger one immediate check-in at boot so a box that was powered off (its
    // token aging toward expiry) renews promptly rather than waiting up to 24h.
    // Best-effort — a failed trigger must never block worker startup.
    try {
      await client.schedule.getHandle(applianceCheckInScheduleId).trigger();
      logger.info('Triggered immediate appliance license check-in at boot');
    } catch (error: any) {
      logger.warn(`Failed to trigger boot-time appliance check-in: ${error?.message || 'unknown error'}`);
    }

    // Entra recurring all-tenant sync schedules are created per tenant so each tenant
    // can honor its own configured sync cadence.
    const entraConfigs = await loadEntraScheduleConfigs();
    for (const config of entraConfigs) {
      const tenantScheduleId = `${ENTRA_SCHEDULE_ID_PREFIX}:${config.tenantId}`;
      if (!config.syncEnabled || !config.hasActiveConnection || !config.hasEnterpriseAddOn) {
        await deleteScheduleIfExists(client, tenantScheduleId);
        continue;
      }

      await upsertSchedule(client, tenantScheduleId, {
        spec: {
          intervals: [{ every: `${config.syncIntervalMinutes}m` }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: entraAllTenantsSyncWorkflow,
          args: [{
            tenantId: config.tenantId,
            trigger: 'scheduled',
          }],
          taskQueue: ENTRA_WORKFLOW_TASK_QUEUE,
          workflowExecutionTimeout: '2h',
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP,
          catchupWindow: '10m',
        },
      });
    }

    await backfillNinjaOneProactiveSchedules();

    // Maintenance jobs that were per-tenant pg-boss crons in CE run on EE as one
    // global Temporal Schedule each, fanning out across tenants inside the
    // activity. overlap=SKIP + a short catchup window prevent run pile-up and
    // post-downtime replay storms; crons keep their original (UTC) cadence.
    const MAINTENANCE_FANOUT_SCHEDULES: Array<{ jobName: string; cron: string }> = [
      { jobName: 'expired-credits', cron: '0 1 * * *' },
      { jobName: 'credit-reconciliation', cron: '0 2 * * *' },
      { jobName: 'cleanup-temporary-workflow-forms', cron: '0 2 * * *' },
      { jobName: 'reconcile-bucket-usage', cron: '0 3 * * *' },
      { jobName: 'process-renewal-queue', cron: '0 5 * * *' },
      { jobName: 'search:reconcile', cron: '0 6 * * *' },
      { jobName: 'expiring-credits-notification', cron: '0 9 * * *' },
      { jobName: 'auto-close-tickets', cron: '*/15 * * * *' },
      { jobName: 'cleanup-webhook-deliveries', cron: '*/15 * * * *' },
      { jobName: 'verify-google-calendar-pubsub', cron: '15 * * * *' },
      { jobName: 'renew-google-gmail-watch', cron: '*/30 * * * *' },
      { jobName: 'renew-teams-meeting-artifact-subscriptions', cron: '*/30 * * * *' },
      { jobName: 'sweep-teams-online-meetings', cron: '*/10 * * * *' },
      { jobName: 'cleanup-ai-session-keys', cron: '*/10 * * * *' },
      { jobName: 'workflow-quota-resume-scan', cron: '*/5 * * * *' },
    ];

    for (const { jobName, cron } of MAINTENANCE_FANOUT_SCHEDULES) {
      await upsertSchedule(client, `maintenance-fanout:${jobName}`, {
        spec: {
          cronExpressions: [cron],
        },
        action: {
          type: 'startWorkflow',
          workflowType: maintenanceJobWorkflow,
          args: [{ jobName }],
          taskQueue: ENTRA_WORKFLOW_TASK_QUEUE,
          workflowExecutionTimeout: '20m',
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP,
          catchupWindow: '1m',
        },
      });
    }

  } catch (error) {
    logger.error('Failed to connect to Temporal for schedule setup', error);
  }
}
