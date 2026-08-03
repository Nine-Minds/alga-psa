'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  CANCELLATION_FEEDBACK_MAX_LENGTH,
  CANCELLATION_FEEDBACK_MIN_LENGTH,
  CANCELLATION_REASON_CATEGORIES,
  cancellationFeedbackSchema,
  type CancellationReasonCategory,
} from '../../../lib/cancellationFeedbackValidation';

interface CancellationFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasonText: string, reasonCategory: CancellationReasonCategory) => Promise<void>;
  onLogout?: () => Promise<void>;
}

const CANCELLATION_REASON_LABEL_KEYS: Record<CancellationReasonCategory, string> = {
  'Pricing too high': 'cancellationModal.reasons.pricingTooHigh',
  'Missing features I need': 'cancellationModal.reasons.missingFeatures',
  'Poor customer support': 'cancellationModal.reasons.poorSupport',
  'Switching to competitor': 'cancellationModal.reasons.switchingCompetitor',
  'No longer need the service': 'cancellationModal.reasons.noLongerNeed',
  Other: 'cancellationModal.reasons.other',
};

export default function CancellationFeedbackModal({
  isOpen,
  onClose,
  onConfirm,
  onLogout,
}: CancellationFeedbackModalProps) {
  const { t } = useTranslation('msp/account');
  const [reasonText, setReasonText] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const cancellationReasons = CANCELLATION_REASON_CATEGORIES.map((value) => ({
    value,
    label: t(CANCELLATION_REASON_LABEL_KEYS[value]),
  }));

  const trimmedReasonLength = reasonText.trim().length;
  const remainingChars = CANCELLATION_FEEDBACK_MAX_LENGTH - reasonText.length;
  const feedbackResult = cancellationFeedbackSchema.safeParse({ reasonText, reasonCategory });
  const hasValidCategory = CANCELLATION_REASON_CATEGORIES.some(
    (category) => category === reasonCategory
  );
  const hasMinimumFeedback = trimmedReasonLength >= CANCELLATION_FEEDBACK_MIN_LENGTH;

  const handleSubmit = async () => {
    const result = cancellationFeedbackSchema.safeParse({ reasonText, reasonCategory });

    if (!hasValidCategory) {
      toast.error(t('messages.feedbackCategoryRequired'));
      return;
    }

    if (!hasMinimumFeedback) {
      toast.error(t('messages.feedbackMinimumLength', { min: CANCELLATION_FEEDBACK_MIN_LENGTH }));
      return;
    }

    if (!result.success) {
      toast.error(t('messages.feedbackMaxLength', { max: CANCELLATION_FEEDBACK_MAX_LENGTH }));
      return;
    }

    setLoading(true);
    try {
      await onConfirm(result.data.reasonText, result.data.reasonCategory);
      toast.success(t('messages.feedbackSubmitted'));
      onClose();
      // Reset form
      setReasonText('');
      setReasonCategory('');

      // Wait 2 seconds to let the user see the toast, then log out
      if (onLogout) {
        setTimeout(async () => {
          await onLogout();
        }, 2000);
      }
    } catch (error) {
      console.error('Error submitting cancellation feedback:', error);
      toast.error(error instanceof Error ? error.message : t('messages.feedbackSubmitFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setReasonText('');
    setReasonCategory('');
    onClose();
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="cancel-feedback-cancel-btn"
        variant="outline"
        onClick={handleClose}
        disabled={loading}
      >
        {t('cancellationModal.keepSubscription')}
      </Button>
      <Button
        id="cancel-feedback-submit-btn"
        variant="default"
        onClick={handleSubmit}
        disabled={loading || !feedbackResult.success}
      >
        {loading ? t('cancellationModal.submitting') : t('cancellationModal.submitFeedback')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('cancellationModal.title')}
      className="max-w-[600px]"
      id="cancellation-feedback-modal"
      footer={footer}
    >
      <div className="space-y-6">
        {/* Warning */}
        <Alert variant="destructive" id="cancellation-warning-alert">
          <div>
            <p className="font-semibold">{t('cancellationModal.beforeYouCancel')}</p>
            <AlertDescription className="mt-1">
              {t('cancellationModal.beforeYouCancelBody')}
            </AlertDescription>
          </div>
        </Alert>

        {/* Reason Category (Required) */}
        <div
          role="group"
          aria-describedby={
            !hasValidCategory
              ? 'reason-category-error'
              : reasonCategory === 'Other'
                ? 'reason-category-other-help'
                : undefined
          }
          aria-invalid={!hasValidCategory}
        >
          <CustomSelect
            id="reason-category"
            label={t('cancellationModal.reasonLabel')}
            options={cancellationReasons}
            value={reasonCategory}
            onValueChange={setReasonCategory}
            placeholder={t('cancellationModal.reasonPlaceholder')}
            disabled={loading}
            required
          />
          {!hasValidCategory && (
            <p id="reason-category-error" className="text-xs text-destructive -mt-3" role="alert">
              {t('cancellationModal.reasonRequired')}
            </p>
          )}
          {reasonCategory === 'Other' && (
            <p id="reason-category-other-help" className="text-xs text-muted-foreground -mt-3">
              {t('cancellationModal.otherReasonHelp')}
            </p>
          )}
        </div>

        {/* Feedback Text (Required) */}
        <div>
          <TextArea
            id="feedback-text"
            label={t('cancellationModal.feedbackLabel')}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={t('cancellationModal.feedbackPlaceholder')}
            disabled={loading}
            maxLength={CANCELLATION_FEEDBACK_MAX_LENGTH}
            required
            className="min-h-[120px]"
            aria-describedby="feedback-text-requirements feedback-text-remaining"
            aria-invalid={!hasMinimumFeedback}
          />
          <div className="flex justify-between text-xs text-muted-foreground -mt-3 px-0.5">
            <span id="feedback-text-requirements" className={!hasMinimumFeedback ? 'text-destructive' : ''}>
              {t('cancellationModal.minimumCharacters', {
                min: CANCELLATION_FEEDBACK_MIN_LENGTH,
              })}
            </span>
            <span
              id="feedback-text-remaining"
              className={remainingChars < 50 ? 'text-destructive font-semibold' : ''}
            >
              {t('cancellationModal.charactersRemaining', { count: remainingChars })}
            </span>
          </div>
        </div>

      </div>
    </Dialog>
  );
}
