import logger from '@alga-psa/core/logger';
import { resolveCeMaintenanceSchedules } from '@alga-psa/types';
import { parseExpression } from 'cron-parser';
import type { IJobRunner } from './interfaces';
import {
  MAINTENANCE_FANOUT_JOB,
  MAINTENANCE_FANOUT_SCHEDULE_PREFIX,
} from './serverMaintenanceJobNames';

export interface CeMaintenanceConvergenceSummary {
  scheduled: string[];
  removed: string[];
  failed: Array<{ scheduleId: string; error: string }>;
}

/** Schedules are evaluated in UTC, matching the EE catalog. */
const CE_MAINTENANCE_TIMEZONE = 'UTC';
/** A fan-out across many tenants can outlast pg-boss's 900s default; an expired job would be retried and run twice. */
const CE_MAINTENANCE_EXPIRE_SECONDS = 3600;

export const ceMaintenanceScheduleId = (jobName: string): string =>
  `${MAINTENANCE_FANOUT_SCHEDULE_PREFIX}${jobName}`;

function isValidCron(cron: string): boolean {
  try {
    parseExpression(cron, { tz: CE_MAINTENANCE_TIMEZONE });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converge CE's durable pg-boss maintenance schedules: one global cron schedule
 * per job, named `maintenance-fanout:<jobName>`, each delivering `{ jobName }` to
 * the `maintenance-fanout` handler. Runs on every boot and on every replica and is
 * idempotent: it upserts the desired schedules (applying cron and environment
 * changes), then unschedules any `maintenance-fanout:*` schedule that is no
 * longer desired. Names outside that prefix are never touched.
 *
 * Returns 'temporal-authority' without doing anything unless the runner is
 * pg-boss and supports global schedules (EE never gets a pg-boss runner; its
 * schedules live in Temporal).
 */
export async function convergeCeMaintenanceSchedules(
  runner: IJobRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<CeMaintenanceConvergenceSummary | 'temporal-authority'> {
  if (
    runner.getRunnerType() !== 'pgboss'
    || typeof runner.scheduleGlobalRecurringJob !== 'function'
  ) {
    logger.info('[ce-maintenance] Skipping CE maintenance schedules (runner is not pg-boss)', {
      runnerType: runner.getRunnerType(),
    });
    return 'temporal-authority';
  }

  const desired = resolveCeMaintenanceSchedules(env, {
    isValidCron,
    onInvalidOverride: ({ jobName, envVar, value }) =>
      logger.error('[ce-maintenance] Invalid cron override; using the default schedule', {
        jobName,
        envVar,
        value,
      }),
  });

  const summary: CeMaintenanceConvergenceSummary = { scheduled: [], removed: [], failed: [] };

  for (const { jobName, cron } of desired) {
    const scheduleId = ceMaintenanceScheduleId(jobName);
    try {
      await runner.scheduleGlobalRecurringJob(MAINTENANCE_FANOUT_JOB, cron, {
        scheduleId,
        timezone: CE_MAINTENANCE_TIMEZONE,
        data: { jobName },
        queuePolicy: 'stately',
        expireInSeconds: CE_MAINTENANCE_EXPIRE_SECONDS,
      });
      summary.scheduled.push(scheduleId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed.push({ scheduleId, error: message });
      logger.error('[ce-maintenance] Failed to schedule maintenance job', { scheduleId, cron, error: message });
    }
  }

  if (typeof runner.listGlobalRecurringJobs === 'function' && typeof runner.unscheduleGlobalRecurringJob === 'function') {
    const wanted = new Set(desired.map(({ jobName }) => ceMaintenanceScheduleId(jobName)));
    try {
      const existing = await runner.listGlobalRecurringJobs(MAINTENANCE_FANOUT_SCHEDULE_PREFIX);
      for (const { scheduleId } of existing) {
        if (!scheduleId.startsWith(MAINTENANCE_FANOUT_SCHEDULE_PREFIX) || wanted.has(scheduleId)) continue;
        try {
          await runner.unscheduleGlobalRecurringJob(scheduleId);
          summary.removed.push(scheduleId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summary.failed.push({ scheduleId, error: message });
          logger.error('[ce-maintenance] Failed to remove stale maintenance schedule', { scheduleId, error: message });
        }
      }
    } catch (error) {
      logger.error('[ce-maintenance] Failed to list maintenance schedules for stale removal', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[ce-maintenance] converged', {
    scheduled: summary.scheduled.length,
    removed: summary.removed.length,
    failed: summary.failed.length,
  });
  return summary;
}
