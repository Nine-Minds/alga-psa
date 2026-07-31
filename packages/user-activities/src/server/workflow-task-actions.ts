/**
 * CE/default workflow-task ACTION seam for the v1 REST API.
 *
 * Workflow confirmation tasks are EE-only. In the Community/default build these are stubs:
 * the list returns an empty page and the single-task operations report the feature as
 * unavailable. The route reads `workflowTasksFeatureEnabled` to decide whether to serve a
 * 404 for detail/claim/unclaim/complete in CE.
 *
 * The EE app build aliases `@alga-psa/user-activities/server/workflow-task-actions` to
 * `ee/server/src/user-activities/workflowTaskActions.server.ts`, which wraps the real
 * `taskInbox` cores in `@alga-psa/workflows`. Mirrors the existing `./workflow-tasks`
 * source seam so the base `@alga-psa/user-activities` package never imports
 * `@alga-psa/workflows`.
 */
import type { IUserWithRoles } from '@alga-psa/types';
import type {
  TaskDetails,
  TaskQueryParams,
  TaskQueryResult,
  TaskSubmissionParams,
} from '@shared/workflow/persistence/taskInboxInterfaces';

/** True only in the EE build; this CE stub always reports the feature off. */
export const workflowTasksFeatureEnabled: boolean = false;

const FEATURE_UNAVAILABLE = 'Workflow tasks are not available in this edition';

/** CE: the inbox is empty. */
export async function listWorkflowTasksForApi(
  _user: IUserWithRoles,
  _tenant: string,
  params?: TaskQueryParams,
): Promise<TaskQueryResult> {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  return { tasks: [], total: 0, page, pageSize, totalPages: 0 };
}

export async function getWorkflowTaskForApi(
  _user: IUserWithRoles,
  _tenant: string,
  _taskId: string,
): Promise<TaskDetails> {
  throw new Error(FEATURE_UNAVAILABLE);
}

export async function claimWorkflowTaskForApi(
  _user: IUserWithRoles,
  _tenant: string,
  _taskId: string,
): Promise<{ success: boolean }> {
  throw new Error(FEATURE_UNAVAILABLE);
}

export async function unclaimWorkflowTaskForApi(
  _user: IUserWithRoles,
  _tenant: string,
  _taskId: string,
): Promise<{ success: boolean }> {
  throw new Error(FEATURE_UNAVAILABLE);
}

export async function completeWorkflowTaskForApi(
  _user: IUserWithRoles,
  _tenant: string,
  _params: TaskSubmissionParams,
): Promise<{ success: boolean }> {
  throw new Error(FEATURE_UNAVAILABLE);
}
