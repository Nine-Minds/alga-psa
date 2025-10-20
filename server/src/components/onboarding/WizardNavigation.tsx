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
  onSaveDraft?: () => void;
  isNextDisabled?: boolean;
  isSkipDisabled?: boolean;
  isLoading?: boolean;
  showSaveDraft?: boolean;
  finishLabel?: string;
  nextLabel?: string;
}

export function WizardNavigation({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  onFinish,
  onSaveDraft,
  isNextDisabled = false,
  isSkipDisabled = false,
  isLoading = false,
  showSaveDraft = false,
  finishLabel = 'Finish Setup',
  nextLabel = 'Next',
}: WizardNavigationProps) {
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="flex justify-between items-center mt-8 pt-6 border-t">
      <div className="flex gap-2">
        <Button
          id="wizard-back"
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isFirstStep}
          className="flex items-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>

        {showSaveDraft && onSaveDraft && (
          <Button
            id="wizard-save-draft"
            type="button"
            variant="secondary"
            onClick={onSaveDraft}
            disabled={isLoading}
          >
            Save as Draft
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        {!isLastStep && !isSkipDisabled && (
          <Button
            id="wizard-skip"
            type="button"
            variant="outline"
            onClick={onSkip}
          >
            Skip
          </Button>
        )}
        
        {isLastStep ? (
          <Button
            id="wizard-finish"
            type="button"
            onClick={onFinish}
            disabled={isNextDisabled}
          >
            {isLoading ? 'Completing...' : finishLabel}
          </Button>
        ) : (
          <Button
            id="wizard-next"
            type="button"
            onClick={onNext}
            disabled={isNextDisabled}
            className="flex items-center gap-2"
          >
            {isLoading ? 'Saving...' : nextLabel}
            {!isLoading && <ChevronRight className="w-4 h-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
