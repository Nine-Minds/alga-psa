'use client';

import React from 'react';
import { Check } from 'lucide-react';
import type { EntraSetupStep } from './entraSetupModel';

// LEVERAGE: pattern wizard-ladder — onboarding/WizardProgress is the clickable
// twin of this; a step ladder that is sometimes navigable and sometimes not
// wants one component with a `navigable` mode rather than two.

interface SetupLadderProps {
  steps: EntraSetupStep[];
  labels: Record<string, string>;
  id?: string;
  /**
   * Revisit a step that is already done. Only completed steps are offered:
   * a locked step has nothing to show and clicking it would be a lie.
   */
  onRevisit?: (stepId: EntraSetupStep['id']) => void;
}

/**
 * Where you are in the four steps, in one line.
 *
 * Forward progress is derived from what the tenant has actually done, so a
 * locked step is inert — clicking it would offer navigation that cannot change
 * anything. Completed steps are a different matter: confirming one mapping
 * advances the ladder, and without a way back the operator could never map the
 * rest of their tenants. The previous screen stacked all four steps as
 * full-width cards, which meant three quarters of the page described work the
 * operator could not do yet.
 */
export function SetupLadder({ steps, labels, id, onRevisit }: SetupLadderProps): React.JSX.Element {
  return (
    <ol className="flex flex-wrap items-stretch gap-2" id={id}>
      {steps.map((step) => {
        const isCurrent = step.state === 'current';
        const isComplete = step.state === 'complete';

        const canRevisit = isComplete && Boolean(onRevisit);
        const Element = canRevisit ? 'button' : 'div';

        return (
          <li
            key={step.id}
            id={`entra-setup-ladder-${step.stepNumber}`}
            data-step-state={step.state}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex min-w-[8rem] flex-1"
          >
            <Element
              {...(canRevisit
                ? {
                    type: 'button' as const,
                    id: `entra-setup-ladder-revisit-${step.stepNumber}`,
                    onClick: () => onRevisit?.(step.id),
                  }
                : {})}
              className={[
                'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left',
                isCurrent
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-border/70 bg-muted/30',
                canRevisit ? 'hover:border-primary-500 hover:bg-primary-50' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isComplete
                    ? 'bg-success text-white'
                    : isCurrent
                      ? 'bg-primary-500 text-white'
                      : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step.stepNumber}
              </span>
              <span
                className={[
                  'truncate text-sm',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                ].join(' ')}
              >
                {labels[step.id]}
              </span>
            </Element>
          </li>
        );
      })}
    </ol>
  );
}

export default SetupLadder;
