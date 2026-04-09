import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import {
  advanceWorkflowRuntimeV2InterpreterState,
  getWorkflowRuntimeV2CurrentStep,
  initializeWorkflowRuntimeV2InterpreterState,
} from '../workflow-runtime-v2-interpreter.js';

const definition: WorkflowDefinition = {
  id: 'wf_1',
  name: 'Test Workflow',
  version: 1,
  payloadSchemaRef: 'workflow.payload.ticket.v1',
  trigger: {
    type: 'schedule',
    runAt: '2026-04-08T00:00:00.000Z',
  },
  steps: [
    {
      id: 'step_1',
      type: 'action.call',
      config: {
        actionId: 'ticket.update',
        version: 1,
      },
    },
    {
      id: 'step_2',
      type: 'control.return',
    },
  ],
};

describe('workflowRuntimeV2Interpreter', () => {
  it('initializes a root sequence frame and points at root.steps[0]', () => {
    const state = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
    });

    expect(state.frames).toHaveLength(1);
    expect(state.frames[0]).toEqual({
      kind: 'sequence',
      path: 'root.steps',
      nextIndex: 0,
      totalSteps: 2,
    });
    expect(state.currentStepPath).toBe('root.steps[0]');

    const current = getWorkflowRuntimeV2CurrentStep({ state, definition });
    expect(current?.path).toBe('root.steps[0]');
    expect(current?.step.id).toBe('step_1');
  });

  it('advances root sequence frame deterministically', () => {
    const state0 = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
    });

    const state1 = advanceWorkflowRuntimeV2InterpreterState(state0);
    const step1 = getWorkflowRuntimeV2CurrentStep({
      state: state1,
      definition,
    });

    expect(state1.frames[0]?.nextIndex).toBe(1);
    expect(state1.currentStepPath).toBe('root.steps[1]');
    expect(step1?.step.type).toBe('control.return');

    const state2 = advanceWorkflowRuntimeV2InterpreterState(state1);
    const step2 = getWorkflowRuntimeV2CurrentStep({
      state: state2,
      definition,
    });

    expect(state2.frames[0]?.nextIndex).toBe(2);
    expect(state2.currentStepPath).toBeNull();
    expect(step2).toBeNull();
  });
});
