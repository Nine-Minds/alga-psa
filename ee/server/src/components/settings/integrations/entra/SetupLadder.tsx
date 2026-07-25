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
}

/**
 * Where you are in the four steps, in one line.
 *
 * Deliberately not interactive: which step is current is derived from what the
 * tenant has actually done, so a clickable ladder would offer navigation that
 * cannot change anything. The previous screen stacked all four steps as
 * full-width cards, which meant three quarters of the page described work the
 * operator could not do yet.
 */
export function SetupLadder({ steps, labels, id }: SetupLadderProps): React.JSX.Element {
  return (
    <ol className="flex flex-wrap items-stretch gap-2" id={id}>
      {steps.map((step) => {
        const isCurrent = step.state === 'current';
        const isComplete = step.state === 'complete';

        return (
          <li
            key={step.id}
            id={`entra-setup-ladder-${step.stepNumber}`}
            data-step-state={step.state}
            aria-current={isCurrent ? 'step' : undefined}
            className={[
              'flex min-w-[8rem] flex-1 items-center gap-2 rounded-md border px-3 py-2',
              isCurrent
                ? 'border-primary-500 bg-primary-50'
                : 'border-border/70 bg-muted/30',
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
          </li>
        );
      })}
    </ol>
  );
}

export default SetupLadder;
