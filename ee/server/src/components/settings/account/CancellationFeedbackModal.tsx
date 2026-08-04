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
  CANCELLATION_REASON_CATEGORIES,
  cancellationFeedbackSchema,
  type CancellationReasonCategory,
} from '../../../lib/cancellationFeedbackValidation';

interface CancellationFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasonText: string, reasonCategory?: CancellationReasonCategory) => Promise<void>;
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

  const handleSubmit = async () => {
    const result = cancellationFeedbackSchema.safeParse({ reasonText, reasonCategory });

    if (!result.success) {
      toast.error(t('messages.feedbackSubmitFailed'));
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
        disabled={loading}
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

        {/* Reason Category (Optional) */}
        <div>
          <CustomSelect
            id="reason-category"
            label={t('cancellationModal.reasonLabel')}
            options={cancellationReasons}
            value={reasonCategory}
            onValueChange={setReasonCategory}
            placeholder={t('cancellationModal.reasonPlaceholder')}
            disabled={loading}
            allowClear
          />
          {reasonCategory === 'Other' && (
            <p id="reason-category-other-help" className="text-xs text-muted-foreground -mt-3">
              {t('cancellationModal.otherReasonHelp')}
            </p>
          )}
        </div>

        {/* Feedback Text (Optional) */}
        <TextArea
          id="feedback-text"
          label={t('cancellationModal.feedbackLabel')}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder={t('cancellationModal.feedbackPlaceholder')}
          disabled={loading}
          className="min-h-[120px]"
        />

      </div>
    </Dialog>
  );
}
