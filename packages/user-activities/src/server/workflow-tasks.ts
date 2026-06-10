import type { Activity, ActivityFilters } from '@alga-psa/types';

/**
 * CE/default workflow-task activity source.
 *
 * Workflow tasks are the only EE-specific activity source. In the Community/default
 * build this stub returns nothing, so no workflow-task rows appear in the dashboard.
 * The EE app build aliases `@alga-psa/user-activities/server/workflow-tasks` to
 * `ee/server/src/user-activities/workflowTasks.server.ts`, which supplies the real
 * query against `workflow_tasks`.
 *
 * Keeping this seam means the base `@alga-psa/user-activities` package never imports
 * `@alga-psa/workflows`, preserving the CE → EE package boundary.
 */
export async function fetchWorkflowTaskActivities(
  _userId: string,
  _tenantId: string,
  _filters: ActivityFilters
): Promise<Activity[]> {
  return [];
}
