import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import {
  WorkflowScheduleStateModel,
  type WorkflowScheduleStateRecord,
} from '@alga-psa/workflows/persistence';
import {
  buildWorkflowScheduleSingletonKey,
  reconcileWorkflowScheduleRegistration,
  WORKFLOW_RECURRING_TRIGGER_JOB,
} from '@alga-psa/workflows/lib/workflowScheduleLifecycle';

import type { IJobRunner, JobHandlerConfig } from './interfaces';
import {
  workflowRecurringScheduledRunHandler,
  type WorkflowScheduledRunJobData,
} from '@alga-psa/jobs/handlers/workflowScheduledRunHandlers';

type IntrospectablePgBossRunner = IJobRunner & {
  hasHandler?: (jobName: string) => boolean;
};

const buildRecurringWorkflowScheduleHandler = (
  queueName: string,
): JobHandlerConfig<WorkflowScheduledRunJobData> => ({
  name: queueName,
  handler: async (jobId, data) => {
    await workflowRecurringScheduledRunHandler(jobId, data);
  },
  retry: { maxAttempts: 3 },
  timeoutMs: 300000,
});

const shouldRehydrateRecurringWorkflowSchedule = (
  schedule: WorkflowScheduleStateRecord,
): boolean => (
  schedule.enabled === true
  && schedule.status === 'scheduled'
  && schedule.trigger_type === 'recurring'
  && typeof schedule.cron === 'string'
  && schedule.cron.trim().length > 0
);

// CE: pg-boss cron schedules persist in pgboss.schedule across restarts, but
// their in-process boss.work() consumers do not — re-register the missing ones.
async function reconcilePgBossWorkflowSchedules(
  runner: IJobRunner,
): Promise<{ registered: number; skipped: number }> {
  const introspectableRunner = runner as IntrospectablePgBossRunner;
  if (typeof introspectableRunner.hasHandler !== 'function') {
    logger.warn('Skipping workflow schedule PG Boss reconciliation because runner introspection is unavailable');
    return { registered: 0, skipped: 0 };
  }

  const adminKnex = await getAdminConnection();
  const schedules = await WorkflowScheduleStateModel.list(adminKnex);
  let registered = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    if (!shouldRehydrateRecurringWorkflowSchedule(schedule)) {
      skipped += 1;
      continue;
    }

    const queueName = buildWorkflowScheduleSingletonKey(schedule.workflow_id, schedule.id);
    if (introspectableRunner.hasHandler(queueName)) {
      skipped += 1;
      continue;
    }

    runner.registerHandler(buildRecurringWorkflowScheduleHandler(queueName));
    registered += 1;
  }

  logger.info('Reconciled workflow schedule PG Boss handlers', {
    registered,
    skipped,
    totalSchedules: schedules.length,
    jobName: WORKFLOW_RECURRING_TRIGGER_JOB,
  });

  return { registered, skipped };
}

// EE: Temporal Schedules persist on the Temporal server, so there is nothing to
// re-subscribe — but pre-cutover schedules created under pg-boss have no
// Temporal Schedule yet. Ensure one exists for each enabled recurring schedule
// (idempotent; converges once the schedule's job row is Temporal-backed).
async function reconcileTemporalWorkflowSchedules(): Promise<{ registered: number; skipped: number }> {
  const adminKnex = await getAdminConnection();
  const schedules = await WorkflowScheduleStateModel.list(adminKnex);
  let ensured = 0;
  let converged = 0;
  let skipped = 0;
  let failed = 0;

  for (const schedule of schedules) {
    try {
      const outcome = await reconcileWorkflowScheduleRegistration(adminKnex, schedule, 'temporal');
      if (outcome === 'ensured') ensured += 1;
      else if (outcome === 'converged') converged += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      logger.warn('Failed to reconcile workflow schedule on Temporal', {
        scheduleId: schedule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Reconciled workflow schedules on Temporal', {
    ensured,
    converged,
    skipped,
    failed,
    totalSchedules: schedules.length,
  });

  return { registered: ensured, skipped: converged + skipped + failed };
}

// Startup reconciler for user-defined workflow schedules. Keeps CE on pg-boss
// (in-process handler rehydration) and EE on Temporal (Temporal Schedule
// creation), matching whichever runner JobRunnerFactory selected.
export async function reconcileWorkflowSchedulePgBossHandlers(
  runner: IJobRunner,
): Promise<{ registered: number; skipped: number }> {
  return runner.getRunnerType() === 'pgboss'
    ? reconcilePgBossWorkflowSchedules(runner)
    : reconcileTemporalWorkflowSchedules();
}
