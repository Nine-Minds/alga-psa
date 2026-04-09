import type { Step, WorkflowDefinition } from '@alga-psa/workflows/runtime';

export type WorkflowRuntimeV2SequenceFrame = {
  kind: 'sequence';
  path: 'root.steps';
  nextIndex: number;
  totalSteps: number;
};

export type WorkflowRuntimeV2InterpreterState = {
  runId: string;
  frames: WorkflowRuntimeV2SequenceFrame[];
  currentStepPath: string | null;
  scopes: WorkflowRuntimeV2ScopeState;
};

export type WorkflowRuntimeV2CurrentStep = {
  path: string;
  step: Step;
};

export function initializeWorkflowRuntimeV2InterpreterState(input: {
  runId: string;
  definition: WorkflowDefinition;
  initialScopes: WorkflowRuntimeV2ScopeState;
}): WorkflowRuntimeV2InterpreterState {
  const totalSteps = input.definition.steps.length;
  const frame: WorkflowRuntimeV2SequenceFrame = {
    kind: 'sequence',
    path: 'root.steps',
    nextIndex: 0,
    totalSteps,
  };

  return {
    runId: input.runId,
    frames: [frame],
    currentStepPath: totalSteps > 0 ? buildRootStepPath(0) : null,
    scopes: input.initialScopes,
  };
}

export function getWorkflowRuntimeV2CurrentStep(input: {
  state: WorkflowRuntimeV2InterpreterState;
  definition: WorkflowDefinition;
}): WorkflowRuntimeV2CurrentStep | null {
  const frame = input.state.frames[input.state.frames.length - 1];
  if (!frame) return null;
  if (frame.kind !== 'sequence' || frame.path !== 'root.steps') return null;
  if (frame.nextIndex >= frame.totalSteps) return null;

  const step = input.definition.steps[frame.nextIndex];
  if (!step) return null;

  return {
    path: buildRootStepPath(frame.nextIndex),
    step,
  };
}

export function advanceWorkflowRuntimeV2InterpreterState(
  state: WorkflowRuntimeV2InterpreterState
): WorkflowRuntimeV2InterpreterState {
  const nextFrames = state.frames.map((frame, index) => {
    if (index !== state.frames.length - 1) return frame;
    if (frame.kind !== 'sequence' || frame.path !== 'root.steps') return frame;
    return {
      ...frame,
      nextIndex: frame.nextIndex + 1,
    };
  });

  const currentFrame = nextFrames[nextFrames.length - 1];
  const currentStepPath = currentFrame && currentFrame.nextIndex < currentFrame.totalSteps
    ? buildRootStepPath(currentFrame.nextIndex)
    : null;

  return {
    ...state,
    frames: nextFrames,
    currentStepPath,
    scopes: state.scopes,
  };
}

export function buildWorkflowRuntimeV2ExpressionContext(scopes: WorkflowRuntimeV2ScopeState): Record<string, unknown> {
  const lexicalTop = scopes.lexical[scopes.lexical.length - 1] ?? {};
  return {
    ...scopes.workflow,
    ...lexicalTop,
    payload: scopes.payload,
    vars: scopes.workflow,
    local: lexicalTop,
    system: scopes.system,
    meta: {
      runId: scopes.system.runId,
      workflowId: scopes.system.workflowId,
      workflowVersion: scopes.system.workflowVersion,
      tenantId: scopes.system.tenantId,
      definitionHash: scopes.system.definitionHash,
      runtimeSemanticsVersion: scopes.system.runtimeSemanticsVersion,
    },
  };
}

export function createWorkflowRuntimeV2InterpreterCheckpoint(input: {
  state: WorkflowRuntimeV2InterpreterState;
  stepCount: number;
}): WorkflowRuntimeV2InterpreterCheckpoint {
  return {
    stepCount: input.stepCount,
    state: JSON.parse(JSON.stringify(input.state)) as WorkflowRuntimeV2InterpreterState,
  };
}

function buildRootStepPath(index: number): string {
  return `root.steps[${index}]`;
}

export type WorkflowRuntimeV2ScopeState = {
  payload: Record<string, unknown>;
  workflow: Record<string, unknown>;
  lexical: Array<Record<string, unknown>>;
  system: {
    runId: string;
    workflowId: string;
    workflowVersion: number;
    tenantId: string | null;
    definitionHash: string | null;
    runtimeSemanticsVersion: string | null;
  };
};

export type WorkflowRuntimeV2InterpreterCheckpoint = {
  stepCount: number;
  state: WorkflowRuntimeV2InterpreterState;
};
