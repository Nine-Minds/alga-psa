'use server';

import { registerWorkflowScheduleJobRunner } from '@alga-psa/workflows/lib/jobRunnerProvider';
import {
  createWorkflowScheduleAction as createWorkflowScheduleActionBase,
  deleteWorkflowScheduleAction as deleteWorkflowScheduleActionBase,
  getWorkflowScheduleAction as getWorkflowScheduleActionBase,
  listWorkflowSchedulesAction as listWorkflowSchedulesActionBase,
  pauseWorkflowScheduleAction as pauseWorkflowScheduleActionBase,
  resumeWorkflowScheduleAction as resumeWorkflowScheduleActionBase,
  updateWorkflowScheduleAction as updateWorkflowScheduleActionBase
} from '@alga-psa/workflows/actions/workflow-schedule-v2-actions';
import { initializeJobRunner } from 'server/src/lib/jobs/initializeJobRunner';

let workflowScheduleJobRunnerRegistered = false;

const ensureWorkflowScheduleJobRunnerRegistered = (): void => {
  if (workflowScheduleJobRunnerRegistered) return;

  registerWorkflowScheduleJobRunner(async () => initializeJobRunner());
  workflowScheduleJobRunnerRegistered = true;
};

export async function listWorkflowSchedulesAction(
  ...args: Parameters<typeof listWorkflowSchedulesActionBase>
): Promise<Awaited<ReturnType<typeof listWorkflowSchedulesActionBase>>> {
  return listWorkflowSchedulesActionBase(...args);
}

export async function getWorkflowScheduleAction(
  ...args: Parameters<typeof getWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof getWorkflowScheduleActionBase>>> {
  return getWorkflowScheduleActionBase(...args);
}

export async function createWorkflowScheduleAction(
  ...args: Parameters<typeof createWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof createWorkflowScheduleActionBase>>> {
  ensureWorkflowScheduleJobRunnerRegistered();
  return createWorkflowScheduleActionBase(...args);
}

export async function updateWorkflowScheduleAction(
  ...args: Parameters<typeof updateWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof updateWorkflowScheduleActionBase>>> {
  ensureWorkflowScheduleJobRunnerRegistered();
  return updateWorkflowScheduleActionBase(...args);
}

export async function pauseWorkflowScheduleAction(
  ...args: Parameters<typeof pauseWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof pauseWorkflowScheduleActionBase>>> {
  ensureWorkflowScheduleJobRunnerRegistered();
  return pauseWorkflowScheduleActionBase(...args);
}

export async function resumeWorkflowScheduleAction(
  ...args: Parameters<typeof resumeWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof resumeWorkflowScheduleActionBase>>> {
  ensureWorkflowScheduleJobRunnerRegistered();
  return resumeWorkflowScheduleActionBase(...args);
}

export async function deleteWorkflowScheduleAction(
  ...args: Parameters<typeof deleteWorkflowScheduleActionBase>
): Promise<Awaited<ReturnType<typeof deleteWorkflowScheduleActionBase>>> {
  ensureWorkflowScheduleJobRunnerRegistered();
  return deleteWorkflowScheduleActionBase(...args);
}
