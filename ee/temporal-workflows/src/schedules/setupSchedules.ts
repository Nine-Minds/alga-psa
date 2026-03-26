import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import { createLogger, format, transports } from 'winston';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { seedNinjaOneProactiveRefreshFromStoredCredentials } from '@ee/lib/integrations/ninjaone/proactiveRefresh';
import {
  calendarWebhookMaintenanceWorkflow,
  emailWebhookMaintenanceWorkflow,
  entraAllTenantsSyncWorkflow,
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

interface EntraScheduleConfigRow {
  tenantId: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  hasActiveConnection: boolean;
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
  const rows = await knex('rmm_integrations')
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
    activeWorkflowId?: string;
    nextRefreshAt?: string;
  };

  if (lifecycle.reconnectRequired) {
    return false;
  }

  // If an active workflow is already tracked, keep current ownership.
  if (lifecycle.activeWorkflowId) {
    return false;
  }

  // If nextRefreshAt exists without active handle, seed to recover ownership.
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
  const rows = await knex('entra_sync_settings as s')
    .leftJoin('entra_partner_connections as c', function joinConnection() {
      this.on('s.tenant', '=', 'c.tenant').andOn(knex.raw('c.is_active = true'));
    })
    .select([
      's.tenant as tenantId',
      's.sync_enabled as syncEnabled',
      's.sync_interval_minutes as syncIntervalMinutes',
      'c.connection_id as activeConnectionId',
    ]);

  return rows.map((row: any) => ({
    tenantId: String(row.tenantId),
    syncEnabled: Boolean(row.syncEnabled),
    syncIntervalMinutes: normalizeIntervalMinutes(row.syncIntervalMinutes),
    hasActiveConnection: Boolean(row.activeConnectionId),
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

    // Entra recurring all-tenant sync schedules are created per tenant so each tenant
    // can honor its own configured sync cadence.
    const entraConfigs = await loadEntraScheduleConfigs();
    for (const config of entraConfigs) {
      const tenantScheduleId = `${ENTRA_SCHEDULE_ID_PREFIX}:${config.tenantId}`;
      if (!config.syncEnabled || !config.hasActiveConnection) {
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

  } catch (error) {
    logger.error('Failed to connect to Temporal for schedule setup', error);
  }
}
