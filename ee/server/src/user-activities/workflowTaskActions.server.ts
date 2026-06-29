// EE implementation of the v1 workflow-task ACTION seam.
//
// `@alga-psa/user-activities/server/workflow-task-actions` resolves here in the EE app
// build (and to packages/user-activities/src/server/workflow-task-actions.ts in CE).
// Wraps the identity-explicit `taskInbox` cores in `@alga-psa/workflows`; gating is by
// build placement, not imports, so the base CE package never depends on EE/workflow code.
import type { IUserWithRoles } from '@alga-psa/types';
import type {
  TaskDetails,
  TaskQueryParams,
  TaskQueryResult,
  TaskSubmissionParams,
} from '@alga-psa/workflows/persistence';
import {
  getUserTasksForApi,
  getTaskDetailsForApi,
  claimTaskForApi,
  unclaimTaskForApi,
  submitTaskFormForApi,
} from '@alga-psa/workflows/actions/workflow-actions/taskInboxCore';

/** True in the EE build: the workflow task inbox is backed by real `taskInbox` cores. */
export const workflowTasksFeatureEnabled: boolean = true;

export async function listWorkflowTasksForApi(
  user: IUserWithRoles,
  tenant: string,
  params?: TaskQueryParams,
): Promise<TaskQueryResult> {
  return getUserTasksForApi(user, tenant, params);
}

export async function getWorkflowTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<TaskDetails> {
  return getTaskDetailsForApi(user, tenant, taskId);
}

export async function claimWorkflowTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<{ success: boolean }> {
  return claimTaskForApi(user, tenant, taskId);
}

export async function unclaimWorkflowTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<{ success: boolean }> {
  return unclaimTaskForApi(user, tenant, taskId);
}

export async function completeWorkflowTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  params: TaskSubmissionParams,
): Promise<{ success: boolean }> {
  return submitTaskFormForApi(user, tenant, params);
}
