/**
 * Dynamic lifecycle for the per-integration RMM alert reconciliation
 * Temporal schedules: ensure on connect, remove on disconnect. The
 * temporal-worker boot reconciliation (setupSchedules.ts) is the source of
 * truth and heals any drift; these helpers just avoid waiting for the next
 * worker restart. Failures are logged, never thrown — schedule lifecycle must
 * not break a connect/disconnect flow.
 */

import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import logger from '@alga-psa/core/logger';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const SCHEDULE_PREFIX = 'rmm-alert-reconciliation';
const TASK_QUEUE = 'tenant-workflows';

async function getTemporalClient(): Promise<Client> {
  const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
  const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace });
}

function scheduleId(tenantId: string, integrationId: string): string {
  return `${SCHEDULE_PREFIX}:${tenantId}:${integrationId}`;
}

export async function ensureRmmAlertPollingSchedule(args: {
  tenantId: string;
  integrationId: string;
  provider: string;
  intervalMinutes?: number;
}): Promise<void> {
  const intervalMinutes = Math.min(60, Math.max(5, Math.round(args.intervalMinutes ?? 15)));
  try {
    const client = await getTemporalClient();
    const id = scheduleId(args.tenantId, args.integrationId);
    const input = {
      spec: { intervals: [{ every: `${intervalMinutes}m` }] },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'rmmAlertReconciliationWorkflow',
        args: [{ tenantId: args.tenantId, integrationId: args.integrationId, provider: args.provider }],
        taskQueue: TASK_QUEUE,
        workflowExecutionTimeout: '30m',
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '5m',
      },
    };
    try {
      await client.schedule.create({ scheduleId: id, ...input } as never);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const handle = client.schedule.getHandle(id);
      await handle.update((prev) => ({ ...prev, ...input }));
    }
    logger.info('[RmmAlertPollingSchedule] ensured', { ...args, intervalMinutes });
  } catch (error) {
    logger.warn('[RmmAlertPollingSchedule] ensure failed (worker boot reconciliation will heal)', {
      ...args,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function removeRmmAlertPollingSchedule(args: {
  tenantId: string;
  integrationId: string;
}): Promise<void> {
  try {
    const client = await getTemporalClient();
    await client.schedule.getHandle(scheduleId(args.tenantId, args.integrationId)).delete();
    logger.info('[RmmAlertPollingSchedule] removed', args);
  } catch (error) {
    if (isNotFound(error)) return;
    logger.warn('[RmmAlertPollingSchedule] remove failed (activity guard makes leftovers no-ops)', {
      ...args,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|AlreadyExists/i.test(message);
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|NotFound/i.test(message);
}
