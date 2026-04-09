import { proxyActivities } from '@temporalio/workflow';
import type { WorkflowRuntimeV2TemporalRunInput } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import {
  advanceWorkflowRuntimeV2InterpreterState,
  getWorkflowRuntimeV2CurrentStep,
  initializeWorkflowRuntimeV2InterpreterState,
} from './workflow-runtime-v2-interpreter.js';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';

const activities = proxyActivities<{
  loadWorkflowRuntimeV2PinnedDefinition(input: {
    runId: string;
    workflowId: string;
    workflowVersion: number;
  }): Promise<{ definition: WorkflowDefinition }>;
  executeWorkflowRuntimeV2Run(input: { runId: string; executionKey: string }): Promise<void>;
  completeWorkflowRuntimeV2Run(input: { runId: string; status: 'SUCCEEDED' | 'FAILED' }): Promise<void>;
}>({
  startToCloseTimeout: '10m',
  retry: {
    maximumAttempts: 1,
  },
});

export async function workflowRuntimeV2RunWorkflow(input: WorkflowRuntimeV2TemporalRunInput): Promise<void> {
  const pinned = await activities.loadWorkflowRuntimeV2PinnedDefinition({
    runId: input.runId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
  });

  let state = initializeWorkflowRuntimeV2InterpreterState({
    runId: input.runId,
    definition: pinned.definition,
  });

  while (true) {
    const current = getWorkflowRuntimeV2CurrentStep({
      state,
      definition: pinned.definition,
    });

    if (!current) {
      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'SUCCEEDED' });
      return;
    }

    state = {
      ...state,
      currentStepPath: current.path,
    };

    if (current.step.type === 'control.return') {
      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'SUCCEEDED' });
      return;
    }

    // Temporary bridge while additional step handlers are moved into the Temporal-native interpreter.
    await activities.executeWorkflowRuntimeV2Run({
      runId: input.runId,
      executionKey: input.executionKey,
    });
    state = advanceWorkflowRuntimeV2InterpreterState(state);
  }
}
