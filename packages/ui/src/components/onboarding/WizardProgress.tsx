'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '@alga-psa/ui/components/Button';

export type WizardStepState = 'complete' | 'current' | 'locked';

export interface WizardStep {
  /** Stable step key, handed back to onStepClick so callers keyed by id need no index math. */
  id?: string;
  label: string;
  state: WizardStepState;
}

interface WizardProgressProps {
  /**
   * Either plain labels, positioned by `currentStep`/`completedSteps`, or steps
   * carrying their own state — for wizards whose progress is derived from what
   * the tenant has actually done rather than from a cursor the user moves.
   */
  steps: string[] | WizardStep[];
  currentStep?: number;
  completedSteps?: Set<number>;
  onStepClick?: (stepIndex: number, step: WizardStep) => void;
  /** Overrides the defaults below; supply only where a wizard's rule genuinely differs. */
  canNavigateToStep?: (stepIndex: number) => boolean;
  /** Automation id root: the container, plus `-<n>` and `-revisit-<n>` per step. */
  id?: string;
}

interface ResolvedStep {
  key: string;
  label: string;
  id?: string;
  state: WizardStepState;
  isCurrent: boolean;
  isComplete: boolean;
}

const stateOf = (isCurrent: boolean, isComplete: boolean): WizardStepState =>
  isCurrent ? 'current' : isComplete ? 'complete' : 'locked';

const hasStepDescriptors = (steps: string[] | WizardStep[]): steps is WizardStep[] =>
  steps.length > 0 && typeof steps[0] !== 'string';

function resolveSteps(
  steps: string[] | WizardStep[],
  currentStep: number,
  completedSteps: Set<number>
): ResolvedStep[] {
  if (hasStepDescriptors(steps)) {
    return steps.map((step, index) => ({
      key: step.id ?? `${step.label}-${index}`,
      label: step.label,
      id: step.id,
      state: step.state,
      isCurrent: step.state === 'current',
      isComplete: step.state === 'complete',
    }));
  }

  // A label-driven step can be both current and complete (navigating back to
  // finished work), which the styling below deliberately distinguishes.
  return steps.map((label, index) => {
    const isCurrent = index === currentStep;
    const isComplete = completedSteps.has(index);
    return { key: label, label, state: stateOf(isCurrent, isComplete), isCurrent, isComplete };
  });
}

export function WizardProgress({
  steps,
  currentStep = 0,
  completedSteps = new Set(),
  onStepClick,
  canNavigateToStep,
  id = 'wizard-progress',
}: WizardProgressProps) {
  const resolved = resolveSteps(steps, currentStep, completedSteps);

  // State-driven wizards offer only completed steps: a locked step has nothing
  // to show, so making it clickable would promise navigation that changes
  // nothing. Label-driven ones reach the first step, where you are, anything
  // finished, and the one just past the last finished step.
  const isNavigable = (index: number, step: ResolvedStep): boolean => {
    if (canNavigateToStep) return canNavigateToStep(index);
    if (hasStepDescriptors(steps)) return step.isComplete;
    return (
      index === 0 ||
      index === currentStep ||
      completedSteps.has(index) ||
      (index > 0 && completedSteps.has(index - 1))
    );
  };

  return (
    <div className="w-full" id={id}>
      <div className="flex items-center justify-between">
        {resolved.map((step, index) => {
          const stepNumber = index + 1;
          const canNavigate = isNavigable(index, step);
          const clickable = canNavigate && Boolean(onStepClick);

          return (
            <React.Fragment key={step.key}>
              <div
                className="flex flex-col items-center"
                id={`${id}-${stepNumber}`}
                data-step-state={step.state}
                aria-current={step.isCurrent ? 'step' : undefined}
              >
                <Button
                  onClick={() =>
                    clickable &&
                    onStepClick?.(index, { id: step.id, label: step.label, state: step.state })
                  }
                  id={`${id}-revisit-${stepNumber}`}
                  disabled={!canNavigate}
                  variant={step.isCurrent ? "secondary" : step.isComplete ? "default" : "outline"}
                  size="icon"
                  className={cn(
                    "w-10 h-10 rounded-full",
                    !canNavigate && "cursor-not-allowed opacity-50"
                  )}
                >
                  {step.isComplete ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    stepNumber
                  )}
                </Button>
                <span className={cn(
                  "mt-2 text-xs font-medium",
                  step.isCurrent && "text-[rgb(var(--color-secondary-600))]",
                  step.isComplete && "text-[rgb(var(--color-primary-600))]",
                  !step.isCurrent && !step.isComplete && "text-[rgb(var(--color-text-500))]"
                )}>
                  {step.label}
                </span>
              </div>

              {index < resolved.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    step.isComplete ? "bg-[rgb(var(--color-primary-500))]" : "bg-[rgb(var(--color-border-300))]"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
