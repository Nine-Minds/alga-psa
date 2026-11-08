'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/client';

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
  finishLabel,
  nextLabel,
  backLabel,
  skipLabel,
  saveDraftLabel,
  savingLabel,
  completingLabel,
}: WizardNavigationProps) {
  const { t } = useTranslation('common');
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="flex w-full justify-between items-center">
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
          {backLabel ?? t('actions.back')}
        </Button>

        {showSaveDraft && onSaveDraft && (
          <Button
            id="wizard-save-draft"
            type="button"
            variant="secondary"
            onClick={onSaveDraft}
            disabled={isLoading}
          >
            {saveDraftLabel ?? t('actions.saveAsDraft')}
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
            {skipLabel ?? t('actions.skip')}
          </Button>
        )}
        
        {isLastStep ? (
          <Button
            id="wizard-finish"
            type="button"
            onClick={onFinish}
            disabled={isNextDisabled}
          >
            {isLoading ? (completingLabel ?? t('actions.completing')) : (finishLabel ?? t('actions.finishSetup'))}
          </Button>
        ) : (
          <Button
            id="wizard-next"
            type="button"
            onClick={onNext}
            disabled={isNextDisabled}
            className="flex items-center gap-2"
          >
            {isLoading ? (savingLabel ?? t('actions.saving')) : (nextLabel ?? t('actions.next'))}
            {!isLoading && <ChevronRight className="w-4 h-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
