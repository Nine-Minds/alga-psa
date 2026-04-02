import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import {
  WorkflowScheduleStateModel,
  type WorkflowScheduleStateRecord,
} from '@alga-psa/workflows/persistence';
import {
  buildWorkflowScheduleSingletonKey,
  WORKFLOW_RECURRING_TRIGGER_JOB,
} from '@alga-psa/workflows/lib/workflowScheduleLifecycle';

import type { IJobRunner, JobHandlerConfig } from './interfaces';
import {
  workflowRecurringScheduledRunHandler,
  type WorkflowScheduledRunJobData,
} from './handlers/workflowScheduledRunHandlers';

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

export async function reconcileWorkflowSchedulePgBossHandlers(
  runner: IJobRunner,
): Promise<{ registered: number; skipped: number }> {
  if (runner.getRunnerType() !== 'pgboss') {
    return { registered: 0, skipped: 0 };
  }

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
