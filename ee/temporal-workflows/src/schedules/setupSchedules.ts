import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import { createLogger, format, transports } from 'winston';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import {
  calendarWebhookMaintenanceWorkflow,
  emailWebhookMaintenanceWorkflow,
  entraAllTenantsSyncWorkflow,
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

  } catch (error) {
    logger.error('Failed to connect to Temporal for schedule setup', error);
  }
}
