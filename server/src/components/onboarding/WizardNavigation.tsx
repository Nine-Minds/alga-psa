'use client';

import React from 'react';
import { Button } from 'server/src/components/ui/Button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  isNextDisabled?: boolean;
  isSkipDisabled?: boolean;
}

export function WizardNavigation({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  onFinish,
  isNextDisabled = false,
  isSkipDisabled = false,
}: WizardNavigationProps) {
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="flex justify-between items-center mt-8 pt-6 border-t">
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        disabled={isFirstStep}
        className="flex items-center gap-2"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </Button>

      <div className="flex gap-2">
        {!isLastStep && !isSkipDisabled && (
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
          >
            Skip
          </Button>
        )}
        
        {isLastStep ? (
          <Button
            type="button"
            onClick={onFinish}
            disabled={isNextDisabled}
          >
            Finish Setup
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onNext}
            disabled={isNextDisabled}
            className="flex items-center gap-2"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}