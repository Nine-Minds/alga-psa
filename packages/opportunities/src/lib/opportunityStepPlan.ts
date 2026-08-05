import type { IOpportunityStep, OpportunityStage } from '@alga-psa/types';
import { OPEN_OPPORTUNITY_STAGES } from './opportunityStages';

export type PlannableStage = (typeof OPEN_OPPORTUNITY_STAGES)[number];

/** An untagged step belongs with the stage the deal is on, so nothing is orphaned. */
export function stepStageOf(step: IOpportunityStep, currentStage: PlannableStage | null): PlannableStage | null {
  return (step.stage as PlannableStage | null | undefined) ?? currentStage;
}

/** The deal's stage, when it is one you can still plan work for. */
export function plannableStage(stage: OpportunityStage): PlannableStage | null {
  return OPEN_OPPORTUNITY_STAGES.find((entry) => entry === stage) ?? null;
}

/**
 * Stages from here to the end of the pipeline that have suggestions to offer
 * and no steps of their own yet — what "plan the rest" would actually add.
 */
export function unplannedRemainingStages(
  steps: IOpportunityStep[],
  currentStage: PlannableStage | null,
  templateCounts: Partial<Record<PlannableStage, number>>,
): PlannableStage[] {
  if (!currentStage) return [];
  return OPEN_OPPORTUNITY_STAGES.slice(OPEN_OPPORTUNITY_STAGES.indexOf(currentStage)).filter(
    (entry) => (templateCounts[entry] ?? 0) > 0 && !steps.some((step) => stepStageOf(step, currentStage) === entry),
  );
}

/** The step the deal is working on right now, if any. */
export function currentStep(steps: IOpportunityStep[]): IOpportunityStep | undefined {
  return steps.find((step) => step.status === 'current');
}

/** The step that should be promoted when the current one is done. */
export function nextPlannedStep(steps: IOpportunityStep[], excludeStepId?: string): IOpportunityStep | undefined {
  return [...steps]
    .filter((step) => step.status === 'planned' && step.step_id !== excludeStepId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))[0];
}

/**
 * What the opportunities row must say so the queue, the weekly digest and the
 * discipline job keep reading a single current action.
 */
export function mirrorOfCurrentStep(step: IOpportunityStep | undefined): {
  next_action: string | null;
  next_action_due: string | null;
} {
  if (!step) return { next_action: null, next_action_due: null };
  return { next_action: step.title, next_action_due: step.due_at ?? null };
}

/** A step with a time on it occupies a slot; a step with only a date does not. */
export function scheduleWindow(
  dueAt: string,
  durationMinutes: number,
): { start: string; end: string } {
  const start = new Date(dueAt);
  const end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Due dates for a template application: each step lands its own offset out. */
export function templateDueDate(from: Date, offsetDays: number): string {
  const due = new Date(from);
  due.setDate(due.getDate() + Math.max(0, offsetDays));
  due.setHours(9, 0, 0, 0);
  return due.toISOString();
}
