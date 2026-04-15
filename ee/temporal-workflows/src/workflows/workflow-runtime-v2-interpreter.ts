import type { ForEachBlock, IfBlock, Step, TryCatchBlock, WorkflowDefinition } from '@alga-psa/workflows/runtime/core';

export type WorkflowRuntimeV2SequenceFrame = {
  kind: 'sequence';
  path: string;
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
  const frame = createSequenceFrame('root.steps', input.definition.steps.length);

  return {
    runId: input.runId,
    frames: [frame],
    currentStepPath: frame.totalSteps > 0 ? buildRootStepPath(0) : null,
    scopes: input.initialScopes,
  };
}

export function getWorkflowRuntimeV2CurrentStep(input: {
  state: WorkflowRuntimeV2InterpreterState;
  definition: WorkflowDefinition;
}): WorkflowRuntimeV2CurrentStep | null {
  const frame = input.state.frames[input.state.frames.length - 1];
  if (!frame) return null;
  if (frame.kind !== 'sequence') return null;
  if (frame.nextIndex >= frame.totalSteps) return null;

  const sequence = resolveSequenceByPath(input.definition, frame.path);
  if (!sequence) return null;

  const step = sequence[frame.nextIndex];
  if (!step) return null;

  return {
    path: buildStepPath(frame.path, frame.nextIndex),
    step,
  };
}

export function advanceWorkflowRuntimeV2InterpreterState(
  state: WorkflowRuntimeV2InterpreterState
): WorkflowRuntimeV2InterpreterState {
  if (state.frames.length === 0) {
    return {
      ...state,
      currentStepPath: null,
    };
  }

  const nextFrames = [...state.frames];
  const current = nextFrames[nextFrames.length - 1];
  if (current?.kind === 'sequence') {
    nextFrames[nextFrames.length - 1] = {
      ...current,
      nextIndex: current.nextIndex + 1,
    };
  }
  while (nextFrames.length > 0) {
    const frame = nextFrames[nextFrames.length - 1];
    if (frame.kind !== 'sequence' || frame.nextIndex < frame.totalSteps) {
      break;
    }
    nextFrames.pop();
  }

  const currentFrame = nextFrames[nextFrames.length - 1];
  const currentStepPath = currentFrame && currentFrame.nextIndex < currentFrame.totalSteps
    ? buildStepPath(currentFrame.path, currentFrame.nextIndex)
    : null;

  return {
    ...state,
    frames: nextFrames,
    currentStepPath,
    scopes: state.scopes,
  };
}

export function pushWorkflowRuntimeV2SequenceFrame(
  state: WorkflowRuntimeV2InterpreterState,
  input: {
    path: string;
    totalSteps: number;
  }
): WorkflowRuntimeV2InterpreterState {
  if (input.totalSteps <= 0) {
    return state;
  }

  const frame = createSequenceFrame(input.path, input.totalSteps);
  return {
    ...state,
    frames: [...state.frames, frame],
    currentStepPath: buildStepPath(frame.path, frame.nextIndex),
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
      ...(scopes.meta ?? {}),
      runId: scopes.system.runId,
      workflowId: scopes.system.workflowId,
      workflowVersion: scopes.system.workflowVersion,
      tenantId: scopes.system.tenantId,
      definitionHash: scopes.system.definitionHash,
      runtimeSemanticsVersion: scopes.system.runtimeSemanticsVersion,
    },
    error: scopes.error ?? null,
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

function buildStepPath(sequencePath: string, index: number): string {
  if (sequencePath === 'root.steps') {
    return buildRootStepPath(index);
  }
  return `${sequencePath}[${index}]`;
}

function createSequenceFrame(path: string, totalSteps: number): WorkflowRuntimeV2SequenceFrame {
  return {
    kind: 'sequence',
    path,
    nextIndex: 0,
    totalSteps,
  };
}

function resolveSequenceByPath(definition: WorkflowDefinition, path: string): Step[] | null {
  if (path === 'root.steps') {
    return definition.steps;
  }
  if (!path.startsWith('root.steps')) {
    return null;
  }

  let sequence: Step[] = definition.steps;
  let cursor = 'root.steps';

  while (cursor !== path) {
    const indexMatch = new RegExp(`^${escapePathForRegex(cursor)}\\[(\\d+)\\]`).exec(path);
    if (!indexMatch) {
      return null;
    }

    const stepIndex = Number(indexMatch[1]);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      return null;
    }

    const step = sequence[stepIndex];
    if (!step) {
      return null;
    }

    const stepPath = `${cursor}[${stepIndex}]`;
    const branchMatch = new RegExp(`^${escapePathForRegex(stepPath)}\\.(then|else|try|catch|body)\\.steps`).exec(path);
    if (!branchMatch) {
      return null;
    }

    const branchName = branchMatch[1];
    const branchSequence = resolveStepBranchSequence(step, branchName);
    if (!branchSequence) {
      return null;
    }
    sequence = branchSequence;
    cursor = `${stepPath}.${branchName}.steps`;
  }

  return sequence;
}

function resolveStepBranchSequence(step: Step, branchName: string): Step[] | null {
  if (branchName === 'then' || branchName === 'else') {
    if (step.type !== 'control.if') {
      return null;
    }
    const ifStep = step as IfBlock;
    const branch = branchName === 'then' ? ifStep.then : (ifStep.else ?? []);
    return Array.isArray(branch) ? branch : null;
  }

  if (branchName === 'body') {
    if (step.type !== 'control.forEach') {
      return null;
    }
    const forEachStep = step as ForEachBlock;
    return Array.isArray(forEachStep.body) ? forEachStep.body : null;
  }

  if (step.type !== 'control.tryCatch') {
    return null;
  }
  const tryCatchStep = step as TryCatchBlock;
  const branch = branchName === 'try' ? tryCatchStep.try : tryCatchStep.catch;
  return Array.isArray(branch) ? branch : null;
}

function escapePathForRegex(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type WorkflowRuntimeV2ScopeState = {
  payload: Record<string, unknown>;
  workflow: Record<string, unknown>;
  lexical: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
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
