'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CancellationFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasonText: string, reasonCategory?: string) => Promise<void>;
  onLogout?: () => Promise<void>;
}

const CANCELLATION_REASON_KEYS = [
  { value: 'Pricing too high', labelKey: 'cancellationModal.reasons.pricingTooHigh' },
  { value: 'Missing features I need', labelKey: 'cancellationModal.reasons.missingFeatures' },
  { value: 'Poor customer support', labelKey: 'cancellationModal.reasons.poorSupport' },
  { value: 'Switching to competitor', labelKey: 'cancellationModal.reasons.switchingCompetitor' },
  { value: 'No longer need the service', labelKey: 'cancellationModal.reasons.noLongerNeed' },
  { value: 'Other', labelKey: 'cancellationModal.reasons.other' },
];

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
  const cancellationReasons = CANCELLATION_REASON_KEYS.map(({ value, labelKey }) => ({
    value,
    label: t(labelKey),
  }));

  const maxChars = 500;
  const remainingChars = maxChars - reasonText.length;

  const handleSubmit = async () => {
    if (!reasonText.trim()) {
      toast.error(t('messages.feedbackReasonRequired'));
      return;
    }

    if (reasonText.length > maxChars) {
      toast.error(t('messages.feedbackMaxLength', { max: maxChars }));
      return;
    }

    setLoading(true);
    try {
      await onConfirm(reasonText.trim(), reasonCategory || undefined);
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
      toast.error(t('messages.feedbackSubmitFailed'));
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
        disabled={loading || !reasonText.trim()}
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

        {/* Feedback Text (Required) */}
        <div>
          <TextArea
            id="feedback-text"
            label={t('cancellationModal.feedbackLabel')}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={t('cancellationModal.feedbackPlaceholder')}
            disabled={loading}
            maxLength={maxChars}
            required
            className="min-h-[120px]"
          />
          <div className="flex justify-between text-xs text-muted-foreground -mt-3 px-0.5">
            <span className="text-destructive">{t('cancellationModal.required')}</span>
            <span className={remainingChars < 50 ? 'text-destructive font-semibold' : ''}>
              {t('cancellationModal.charactersRemaining', { count: remainingChars })}
            </span>
          </div>
        </div>

      </div>
    </Dialog>
  );
}
