'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '@alga-psa/ui/components/Button';

interface WizardProgressProps {
  steps: string[];
  currentStep: number;
  completedSteps?: Set<number>;
  onStepClick?: (stepIndex: number) => void;
  canNavigateToStep?: (stepIndex: number) => boolean;
}

export function WizardProgress({
  steps,
  currentStep,
  completedSteps = new Set(),
  onStepClick,
  canNavigateToStep = () => true,
}: WizardProgressProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = completedSteps.has(index);
          const isSkipped = index < currentStep && !isCompleted;
          const canNavigate = canNavigateToStep(index);
          
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center">
                <Button
                  onClick={() => canNavigate && onStepClick?.(index)}
                  id="onboarding-wizard-step-button"
                  disabled={!canNavigate}
                  variant={isActive ? "secondary" : isCompleted ? "default" : "outline"}
                  size="icon"
                  className={cn(
                    "w-10 h-10 rounded-full",
                    !canNavigate && "cursor-not-allowed opacity-50"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    index + 1
                  )}
                </Button>
                <span className={cn(
                  "mt-2 text-xs font-medium",
                  isActive && "text-[rgb(var(--color-secondary-600))]",
                  isCompleted && "text-[rgb(var(--color-primary-600))]",
                  !isActive && !isCompleted && "text-[rgb(var(--color-text-500))]"
                )}>
                  {step}
                </span>
              </div>
              
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    isCompleted ? "bg-[rgb(var(--color-primary-500))]" : "bg-[rgb(var(--color-border-300))]"
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
