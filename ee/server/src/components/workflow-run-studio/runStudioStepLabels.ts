import type { ForEachBlock, IfBlock, NodeStep, Step, TryCatchBlock } from '@alga-psa/workflows/runtime/client';

type TFn = (key: string, options?: Record<string, unknown>) => string;

const TYPE_LABEL_DEFAULTS: Record<string, { key: string; defaultValue: string }> = {
  'control.if': { key: 'runStudio.stepLabels.ifCondition', defaultValue: 'If Condition' },
  'control.forEach': { key: 'runStudio.stepLabels.forEach', defaultValue: 'For Each' },
  'control.tryCatch': { key: 'runStudio.stepLabels.tryCatch', defaultValue: 'Try/Catch' },
  'control.return': { key: 'runStudio.stepLabels.return', defaultValue: 'Return' },
  'control.callWorkflow': { key: 'runStudio.stepLabels.callWorkflow', defaultValue: 'Call Workflow' },
  'event.wait': { key: 'runStudio.stepLabels.waitForEvent', defaultValue: 'Wait for Event' },
  'time.wait': { key: 'runStudio.stepLabels.waitForTime', defaultValue: 'Wait for Time' },
  'human.task': { key: 'runStudio.stepLabels.humanTask', defaultValue: 'Human Task' },
  'state.set': { key: 'runStudio.stepLabels.setState', defaultValue: 'Set State' },
  'transform.assign': { key: 'runStudio.stepLabels.assign', defaultValue: 'Set variables' },
};

const getActionId = (step: Step): string | undefined => {
  if (step.type !== 'action.call') return undefined;
  const actionId = ((step as NodeStep).config as { actionId?: unknown } | undefined)?.actionId;
  return typeof actionId === 'string' && actionId.trim() ? actionId.trim() : undefined;
};

/**
 * The name a person gave the step (as shown in the designer), else the action's label, else a
 * label for the step type. Never the raw action id when a friendlier name exists.
 */
export const getRunStudioStepLabel = (
  step: Step,
  t: TFn,
  actionLabels: ReadonlyMap<string, string> = new Map()
): string => {
  const name = (step as { name?: unknown }).name;
  if (typeof name === 'string' && name.trim()) return name.trim();

  const actionId = getActionId(step);
  if (actionId) return actionLabels.get(actionId) ?? actionId;

  const typeLabel = TYPE_LABEL_DEFAULTS[step.type];
  return typeLabel ? t(typeLabel.key, { defaultValue: typeLabel.defaultValue }) : step.id;
};

/** Secondary line for a step: the action id for actions, the step type otherwise. */
export const getRunStudioStepSubtitle = (step: Step): string => getActionId(step) ?? step.type;

/** True when some action step has no name of its own, so action labels are needed. */
export const needsActionLabels = (steps: Step[]): boolean =>
  collectRunStudioSteps(steps).some((step) => {
    const name = (step as { name?: unknown }).name;
    return Boolean(getActionId(step)) && !(typeof name === 'string' && name.trim());
  });

/** Every step in the definition, nested branches included, in display order. */
export const collectRunStudioSteps = (steps: Step[]): Step[] =>
  steps.flatMap((step) => {
    const nested: Step[] = [];
    if (step.type === 'control.if') {
      nested.push(...(step as IfBlock).then, ...((step as IfBlock).else ?? []));
    } else if (step.type === 'control.tryCatch') {
      nested.push(...(step as TryCatchBlock).try, ...(step as TryCatchBlock).catch);
    } else if (step.type === 'control.forEach') {
      nested.push(...(step as ForEachBlock).body);
    }
    return [step, ...collectRunStudioSteps(nested)];
  });
