import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import {
  buildWorkflowRuntimeV2ExpressionContext,
  createWorkflowRuntimeV2InterpreterCheckpoint,
  advanceWorkflowRuntimeV2InterpreterState,
  getWorkflowRuntimeV2CurrentStep,
  initializeWorkflowRuntimeV2InterpreterState,
  type WorkflowRuntimeV2ScopeState,
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

const initialScopes: WorkflowRuntimeV2ScopeState = {
  payload: {
    ticketId: 'ticket_1',
    priority: 'high',
  },
  workflow: {
    retries: 0,
  },
  lexical: [],
  system: {
    runId: 'run_123',
    workflowId: 'wf_1',
    workflowVersion: 1,
    tenantId: 'tenant_1',
    definitionHash: 'abc123',
    runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
  },
};

describe('workflowRuntimeV2Interpreter', () => {
  it('initializes a root sequence frame and points at root.steps[0]', () => {
    const state = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
      initialScopes,
    });

    expect(state.frames).toHaveLength(1);
    expect(state.frames[0]).toEqual({
      kind: 'sequence',
      path: 'root.steps',
      nextIndex: 0,
      totalSteps: 2,
    });
    expect(state.currentStepPath).toBe('root.steps[0]');
    expect(state.scopes).toEqual(initialScopes);

    const current = getWorkflowRuntimeV2CurrentStep({ state, definition });
    expect(current?.path).toBe('root.steps[0]');
    expect(current?.step.id).toBe('step_1');
  });

  it('advances root sequence frame deterministically', () => {
    const state0 = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
      initialScopes,
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

    expect(state2.frames).toEqual([]);
    expect(state2.currentStepPath).toBeNull();
    expect(state2.scopes).toEqual(initialScopes);
    expect(step2).toBeNull();
  });

  it('builds author-friendly expression context from normalized scopes', () => {
    const context = buildWorkflowRuntimeV2ExpressionContext({
      ...initialScopes,
      workflow: {
        retries: 2,
        status: 'running',
      },
      lexical: [
        { item: 'A' },
        { item: 'B', index: 1 },
      ],
    });

    expect(context.payload).toEqual(initialScopes.payload);
    expect(context.vars).toEqual({ retries: 2, status: 'running' });
    expect(context.local).toEqual({ item: 'B', index: 1 });
    expect(context.retries).toBe(2);
    expect(context.item).toBe('B');
    expect(context.meta).toEqual({
      runId: 'run_123',
      workflowId: 'wf_1',
      workflowVersion: 1,
      tenantId: 'tenant_1',
      definitionHash: 'abc123',
      runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
    });
  });

  it('keeps interpreter state serializable for deterministic replay/resume', () => {
    const state0 = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
      initialScopes,
    });
    const state1 = advanceWorkflowRuntimeV2InterpreterState(state0);

    const restored = JSON.parse(JSON.stringify(state1));
    const current = getWorkflowRuntimeV2CurrentStep({
      state: restored,
      definition,
    });

    expect(restored).toEqual(state1);
    expect(current?.path).toBe('root.steps[1]');
    expect(current?.step.id).toBe('step_2');
  });

  it('creates continue-as-new checkpoints that preserve interpreter progression', () => {
    const state0 = initializeWorkflowRuntimeV2InterpreterState({
      runId: 'run_123',
      definition,
      initialScopes,
    });
    const state1 = advanceWorkflowRuntimeV2InterpreterState(state0);

    const checkpoint = createWorkflowRuntimeV2InterpreterCheckpoint({
      state: state1,
      stepCount: 250,
    });
    const current = getWorkflowRuntimeV2CurrentStep({
      state: checkpoint.state,
      definition,
    });

    expect(checkpoint.stepCount).toBe(250);
    expect(checkpoint.state).toEqual(state1);
    expect(current?.path).toBe('root.steps[1]');
  });
});
