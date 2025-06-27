'use client';

import React from 'react';
import { cn } from 'server/src/lib/utils';
import { Check } from 'lucide-react';

interface WizardProgressProps {
  steps: string[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  canNavigateToStep?: (stepIndex: number) => boolean;
}

export function WizardProgress({
  steps,
  currentStep,
  onStepClick,
  canNavigateToStep = () => true,
}: WizardProgressProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          const canNavigate = canNavigateToStep(index);
          
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center">
                <button
                  onClick={() => canNavigate && onStepClick?.(index)}
                  disabled={!canNavigate}
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                    isActive && "bg-purple-600 text-white",
                    isCompleted && "bg-green-600 text-white",
                    !isActive && !isCompleted && "bg-gray-200 text-gray-600",
                    canNavigate && "cursor-pointer hover:opacity-80",
                    !canNavigate && "cursor-not-allowed opacity-50"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    index + 1
                  )}
                </button>
                <span className={cn(
                  "mt-2 text-xs font-medium",
                  isActive && "text-purple-600",
                  isCompleted && "text-green-600",
                  !isActive && !isCompleted && "text-gray-500"
                )}>
                  {step}
                </span>
              </div>
              
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    isCompleted ? "bg-green-600" : "bg-gray-200"
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