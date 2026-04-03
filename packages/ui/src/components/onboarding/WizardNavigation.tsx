'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
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
  backLabel?: string;
  skipLabel?: string;
  saveDraftLabel?: string;
  savingLabel?: string;
  completingLabel?: string;
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
  backLabel = 'Back',
  skipLabel = 'Skip',
  saveDraftLabel = 'Save as Draft',
  savingLabel = 'Saving...',
  completingLabel = 'Completing...',
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
          {backLabel}
        </Button>

        {showSaveDraft && onSaveDraft && (
          <Button
            id="wizard-save-draft"
            type="button"
            variant="secondary"
            onClick={onSaveDraft}
            disabled={isLoading}
          >
            {saveDraftLabel}
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
            {skipLabel}
          </Button>
        )}
        
        {isLastStep ? (
          <Button
            id="wizard-finish"
            type="button"
            onClick={onFinish}
            disabled={isNextDisabled}
          >
            {isLoading ? completingLabel : finishLabel}
          </Button>
        ) : (
          <Button
            id="wizard-next"
            type="button"
            onClick={onNext}
            disabled={isNextDisabled}
            className="flex items-center gap-2"
          >
            {isLoading ? savingLabel : nextLabel}
            {!isLoading && <ChevronRight className="w-4 h-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
