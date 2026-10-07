import type { ForEachBlock, IfBlock, Step, TryCatchBlock } from '@alga-psa/workflows/runtime/client';

/**
 * Navigation over a workflow's step tree. Pipe paths name a list of steps:
 * `root` is the top level, `root.steps[2].then` is the Then branch of the third step, and so on.
 */
// LEVERAGE: pattern step-tree-traversal — WorkflowDesigner.tsx still hand-rolls if/tryCatch/forEach
// branch walks (updateStepsAtPath, buildStepPathMap, removeStepById, buildPathBreadcrumbs, the
// selected-step search); they could all be built on getStepBranches.

export type PipeBranch = 'then' | 'else' | 'try' | 'catch' | 'body';

export type PipeSegment = {
  index: number;
  branch: PipeBranch;
};

export const parsePipePath = (pipePath: string): PipeSegment[] => {
  const segments: PipeSegment[] = [];
  const regex = /steps\[(\d+)\]\.(then|else|try|catch|body)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pipePath)) !== null) {
    segments.push({ index: Number(match[1]), branch: match[2] as PipeBranch });
  }
  return segments;
};

/** The branches of a container step, in display order. Plain steps have none. */
export const getStepBranches = (step: Step): Array<{ branch: PipeBranch; steps: Step[] }> => {
  if (step.type === 'control.if') {
    const ifStep = step as IfBlock;
    return [
      { branch: 'then', steps: ifStep.then },
      { branch: 'else', steps: ifStep.else ?? [] },
    ];
  }
  if (step.type === 'control.tryCatch') {
    const tcStep = step as TryCatchBlock;
    return [
      { branch: 'try', steps: tcStep.try },
      { branch: 'catch', steps: tcStep.catch },
    ];
  }
  if (step.type === 'control.forEach') {
    return [{ branch: 'body', steps: (step as ForEachBlock).body }];
  }
  return [];
};

export const getStepsAtPath = (steps: Step[], segments: PipeSegment[]): Step[] => {
  if (segments.length === 0) return steps;
  const [current, ...rest] = segments;
  const step = steps[current.index];
  if (!step) return [];
  const branch = getStepBranches(step).find((candidate) => candidate.branch === current.branch);
  return branch ? getStepsAtPath(branch.steps, rest) : [];
};

export type StepLocation = {
  step: Step;
  /** Pipe holding the step. */
  pipePath: string;
  /** Position of the step inside its pipe. */
  index: number;
};

export const findStepLocation = (steps: Step[], stepId: string, pipePath = 'root'): StepLocation | null => {
  for (const [index, step] of steps.entries()) {
    if (step.id === stepId) return { step, pipePath, index };
    for (const branch of getStepBranches(step)) {
      const found = findStepLocation(branch.steps, stepId, `${pipePath}.steps[${index}].${branch.branch}`);
      if (found) return found;
    }
  }
  return null;
};

/** Where the next step added from the palette goes: a pipe and a position inside it. */
export type WorkflowInsertionTarget = {
  pipePath: string;
  index: number;
};

/**
 * Insertion target that follows a selected step. A container step (If, For each, Try) takes new
 * steps at the end of its first branch, since a new container is usually filled next. Any other
 * step takes new steps right after itself.
 */
export const getInsertionTargetForSelectedStep = (steps: Step[], stepId: string): WorkflowInsertionTarget | null => {
  const location = findStepLocation(steps, stepId);
  if (!location) return null;
  const [firstBranch] = getStepBranches(location.step);
  if (firstBranch) {
    return {
      pipePath: `${location.pipePath}.steps[${location.index}].${firstBranch.branch}`,
      index: firstBranch.steps.length,
    };
  }
  return { pipePath: location.pipePath, index: location.index + 1 };
};

export const getEndOfPipeTarget = (steps: Step[], pipePath: string): WorkflowInsertionTarget => {
  const validPipePath = isPipePathValid(steps, pipePath) ? pipePath : 'root';
  return {
    pipePath: validPipePath,
    index: getStepsAtPath(steps, parsePipePath(validPipePath)).length,
  };
};

/** Keeps a target valid after the step tree changes (e.g. a branch shrank). */
export const clampInsertionTarget = (steps: Step[], target: WorkflowInsertionTarget): WorkflowInsertionTarget => {
  if (!isPipePathValid(steps, target.pipePath)) return getEndOfPipeTarget(steps, 'root');
  const pipeSteps = getStepsAtPath(steps, parsePipePath(target.pipePath));
  return { pipePath: target.pipePath, index: Math.max(0, Math.min(target.index, pipeSteps.length)) };
};

export type InsertionTargetDescription =
  | { kind: 'after'; stepLabel: string; containerLabel: string | null }
  | { kind: 'start'; containerLabel: string | null }
  | { kind: 'end'; containerLabel: string | null };

const BRANCH_LABEL_DEFAULTS: Record<PipeBranch, string> = {
  then: 'Then',
  else: 'Else',
  try: 'Try',
  catch: 'Catch',
  body: 'Body',
};

/**
 * Plain-language location of an insertion target. `containerLabel` is null for the top level and
 * otherwise reads like "If › Then".
 */
export const describeInsertionTarget = (
  steps: Step[],
  target: WorkflowInsertionTarget,
  getStepLabel: (step: Step) => string,
  getBranchLabel: (branch: PipeBranch) => string = (branch) => BRANCH_LABEL_DEFAULTS[branch]
): InsertionTargetDescription => {
  const segments = parsePipePath(target.pipePath);
  let containerLabel: string | null = null;
  let currentSteps = steps;
  for (const segment of segments) {
    const container = currentSteps[segment.index];
    if (!container) break;
    containerLabel = `${getStepLabel(container)} › ${getBranchLabel(segment.branch)}`;
    currentSteps = getStepBranches(container).find((branch) => branch.branch === segment.branch)?.steps ?? [];
  }

  const index = Math.max(0, Math.min(target.index, currentSteps.length));
  if (index >= currentSteps.length) return { kind: 'end', containerLabel };
  if (index === 0) return { kind: 'start', containerLabel };
  return { kind: 'after', stepLabel: getStepLabel(currentSteps[index - 1]), containerLabel };
};

/** True when every container on the pipe path exists and has the named branch. */
export const isPipePathValid = (steps: Step[], pipePath: string): boolean => {
  if (pipePath === 'root') return true;
  if (!pipePath.startsWith('root.')) return false;
  let currentSteps = steps;
  for (const segment of parsePipePath(pipePath)) {
    const container = currentSteps[segment.index];
    const branch = container ? getStepBranches(container).find((candidate) => candidate.branch === segment.branch) : undefined;
    if (!branch) return false;
    currentSteps = branch.steps;
  }
  return true;
};
