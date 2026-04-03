import { afterEach, describe, expect, it } from 'vitest';

import {
  getWorkflowScheduleJobRunner,
  registerWorkflowScheduleJobRunner,
  resetWorkflowScheduleJobRunner,
  type WorkflowScheduleJobRunner,
} from './jobRunnerProvider';

describe('jobRunnerProvider', () => {
  afterEach(() => {
    resetWorkflowScheduleJobRunner();
  });

  it('reads the registered job runner factory from global state', async () => {
    const runner: WorkflowScheduleJobRunner = {
      scheduleJobAt: async () => ({ jobId: 'job-1', externalId: null }),
      scheduleRecurringJob: async () => ({ jobId: 'job-2', externalId: null }),
      cancelJob: async () => true,
      getJobStatus: async () => ({ status: 'scheduled' }),
    };

    registerWorkflowScheduleJobRunner(async () => runner);

    await expect(getWorkflowScheduleJobRunner()).resolves.toBe(runner);
  });

  it('throws when no job runner has been registered', async () => {
    await expect(getWorkflowScheduleJobRunner()).rejects.toThrow(
      'Workflow schedule job runner has not been registered'
    );
  });
});
