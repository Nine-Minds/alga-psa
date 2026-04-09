import { continueAsNew, proxyActivities } from '@temporalio/workflow';
import type { WorkflowRuntimeV2TemporalRunInput } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import {
  advanceWorkflowRuntimeV2InterpreterState,
  createWorkflowRuntimeV2InterpreterCheckpoint,
  getWorkflowRuntimeV2CurrentStep,
  initializeWorkflowRuntimeV2InterpreterState,
  type WorkflowRuntimeV2InterpreterCheckpoint,
  type WorkflowRuntimeV2InterpreterState,
  type WorkflowRuntimeV2ScopeState,
} from './workflow-runtime-v2-interpreter.js';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';

const activities = proxyActivities<{
  loadWorkflowRuntimeV2PinnedDefinition(input: {
    runId: string;
    workflowId: string;
    workflowVersion: number;
  }): Promise<{
    definition: WorkflowDefinition;
    initialScopes: WorkflowRuntimeV2ScopeState;
  }>;
  executeWorkflowRuntimeV2Run(input: { runId: string; executionKey: string }): Promise<void>;
  completeWorkflowRuntimeV2Run(input: { runId: string; status: 'SUCCEEDED' | 'FAILED' }): Promise<void>;
}>({
  startToCloseTimeout: '10m',
  retry: {
    maximumAttempts: 1,
  },
});

const CONTINUE_AS_NEW_EVERY_STEPS = 250;

type WorkflowRuntimeV2RunWorkflowInput = WorkflowRuntimeV2TemporalRunInput & {
  checkpoint?: WorkflowRuntimeV2InterpreterCheckpoint;
};

export async function workflowRuntimeV2RunWorkflow(input: WorkflowRuntimeV2RunWorkflowInput): Promise<void> {
  const pinned = await activities.loadWorkflowRuntimeV2PinnedDefinition({
    runId: input.runId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
  });

  let state: WorkflowRuntimeV2InterpreterState = input.checkpoint?.state ?? initializeWorkflowRuntimeV2InterpreterState({
    runId: input.runId,
    definition: pinned.definition,
    initialScopes: pinned.initialScopes,
  });
  let stepCount = input.checkpoint?.stepCount ?? 0;

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
    stepCount += 1;

    if (stepCount > 0 && stepCount % CONTINUE_AS_NEW_EVERY_STEPS === 0) {
      const checkpoint = createWorkflowRuntimeV2InterpreterCheckpoint({
        state,
        stepCount,
      });
      await continueAsNew<typeof workflowRuntimeV2RunWorkflow>({
        ...input,
        checkpoint,
      });
    }
  }
}
