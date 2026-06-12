'use client';

import type { ActivityCrossFeatureCallbacks } from '@alga-psa/ui/context';

/**
 * Client-side workflow-task cross-feature members.
 *
 * The base user-activities components consume these via `useActivityCrossFeature()` and
 * treat them as optional. They render the EE task form and run the EE task-inbox actions
 * (dismiss/hide/unhide), all of which live in `@alga-psa/workflows` and must not be
 * imported by CE-safe packages.
 */
export type WorkflowTaskCrossFeatureMembers = Pick<
  ActivityCrossFeatureCallbacks,
  'getTaskDetails' | 'dismissTask' | 'hideTask' | 'unhideTask' | 'renderWorkflowTaskForm'
>;

/**
 * CE/default: workflow tasks are EE-only, so no workflow-task members are supplied.
 * Base components degrade to an Enterprise placeholder / no-op when these are absent.
 * The EE app build aliases `@alga-psa/user-activities/client/workflow-tasks` to the real
 * implementation in `ee/server/src/user-activities/workflowTasks.client.tsx`.
 */
export function getWorkflowTaskCrossFeatureMembers(): WorkflowTaskCrossFeatureMembers {
  return {};
}
