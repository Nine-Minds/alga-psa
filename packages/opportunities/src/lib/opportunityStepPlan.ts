import type { IOpportunityStep } from '@alga-psa/types';

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
