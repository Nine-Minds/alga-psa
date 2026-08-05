import type { IOpportunityStep } from '@alga-psa/types';

/**
 * Planned steps that may serve as the successor of the step being completed.
 * A step can never be its own next step — the server rejects that pairing, so
 * the dialog must not offer it in the first place.
 */
export function successorPlannedSteps(
  steps: IOpportunityStep[],
  completingStepId?: string | null,
): IOpportunityStep[] {
  return steps.filter((step) => step.status === 'planned' && step.step_id !== completingStepId);
}
