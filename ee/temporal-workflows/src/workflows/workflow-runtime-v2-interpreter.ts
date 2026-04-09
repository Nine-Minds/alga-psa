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
};

export type WorkflowRuntimeV2CurrentStep = {
  path: string;
  step: Step;
};

export function initializeWorkflowRuntimeV2InterpreterState(input: {
  runId: string;
  definition: WorkflowDefinition;
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
  };
}

function buildRootStepPath(index: number): string {
  return `root.steps[${index}]`;
}
