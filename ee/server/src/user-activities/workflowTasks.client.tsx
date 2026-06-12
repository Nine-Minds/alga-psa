'use client';

// EE implementation of the client-side workflow-task cross-feature members.
//
// `@alga-psa/user-activities/client/workflow-tasks` resolves here in the EE app build
// (and to packages/user-activities/src/client/workflow-tasks.tsx in CE).
// This is the only place the user-activities feature reaches into `@alga-psa/workflows`
// for client rendering/actions — it lives under ee/ so CE never bundles it.
import React from 'react';
import type {
  ActivityCrossFeatureCallbacks,
  ActivityWorkflowTaskFormRenderProps,
} from '@alga-psa/ui/context';
import { TaskForm } from '@alga-psa/workflows/components';
import {
  getTaskDetails,
  dismissTask,
  hideTask,
  unhideTask,
} from '@alga-psa/workflows/actions/workflow-actions/taskInboxActions';

type WorkflowTaskCrossFeatureMembers = Pick<
  ActivityCrossFeatureCallbacks,
  'getTaskDetails' | 'dismissTask' | 'hideTask' | 'unhideTask' | 'renderWorkflowTaskForm'
>;

export function getWorkflowTaskCrossFeatureMembers(): WorkflowTaskCrossFeatureMembers {
  return {
    getTaskDetails: (taskId: string) => getTaskDetails(taskId),
    dismissTask: (taskId: string) => dismissTask(taskId),
    hideTask: (taskId: string) => hideTask(taskId),
    unhideTask: (taskId: string) => unhideTask(taskId),
    renderWorkflowTaskForm: (props: ActivityWorkflowTaskFormRenderProps) => (
      <TaskForm
        taskId={props.taskId}
        schema={props.schema}
        uiSchema={props.uiSchema}
        initialFormData={props.initialFormData}
        onComplete={props.onComplete}
        contextData={props.contextData}
        executionId={props.executionId}
        isInDrawer={props.isInDrawer}
      />
    ),
  };
}
