'use client';

import React, { useState } from 'react';
import { Dialog, DialogDescription } from '@alga-psa/ui/components/Dialog';
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
  subscriptionEndDate?: string | null;
  hasScheduledLicenseChange?: boolean;
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
  subscriptionEndDate,
  hasScheduledLicenseChange = false,
}: CancellationFeedbackModalProps) {
  const { t } = useTranslation('msp/account');
  const [reasonText, setReasonText] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const cancellationReasons = CANCELLATION_REASON_CATEGORIES.map((value) => ({
    value,
    label: t(CANCELLATION_REASON_LABEL_KEYS[value]),
  }));
  const parsedEndDate = subscriptionEndDate ? new Date(subscriptionEndDate) : null;
  const formattedEndDate = parsedEndDate && !Number.isNaN(parsedEndDate.getTime())
    ? parsedEndDate.toLocaleDateString()
    : t('cancellationModal.currentBillingPeriod');

  const handleSubmit = async () => {
    const result = cancellationFeedbackSchema.safeParse({ reasonText, reasonCategory });

    if (!result.success) {
      toast.error(t('messages.cancelSubscriptionFailed'));
      return;
    }

    setLoading(true);
    try {
      await onConfirm(result.data.reasonText, result.data.reasonCategory);
      toast.success(t('messages.cancellationScheduled'));
      onClose();
      // Reset form
      setReasonText('');
      setReasonCategory('');
    } catch (error) {
      console.error('Error canceling subscription:', error);
      toast.error(error instanceof Error ? error.message : t('messages.cancelSubscriptionFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;

    setReasonText('');
    setReasonCategory('');
    onClose();
  };

  const footer = (
    <>
      <Button
        id="cancel-feedback-cancel-btn"
        variant="outline"
        onClick={handleClose}
        disabled={loading}
      >
        {t('cancellationModal.keepSubscription')}
      </Button>
      <Button
        id="confirm-cancellation-btn"
        variant="destructive"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? t('cancellationModal.canceling') : t('dangerZone.cancelSubscription')}
      </Button>
    </>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('cancellationModal.title')}
      className="max-w-xl"
      id="cancellation-feedback-modal"
      footer={footer}
      draggable={false}
      hideCloseButton={loading}
    >
      <div className="space-y-5">
        {/* Warning */}
        <Alert variant="destructive" id="cancellation-warning-alert">
          <AlertDescription>
            <DialogDescription>
              {t('cancellationModal.beforeYouCancelBody', { date: formattedEndDate })}
            </DialogDescription>
            {hasScheduledLicenseChange && (
              <p className="mt-2">{t('cancellationModal.replacesScheduledChange')}</p>
            )}
          </AlertDescription>
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
        </div>

        {/* Feedback Text (Optional) */}
        <TextArea
          id="feedback-text"
          label={t('cancellationModal.feedbackLabel')}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder={t('cancellationModal.feedbackPlaceholder')}
          disabled={loading}
          rows={4}
          wrapperClassName="mb-0"
        />
      </div>
    </Dialog>
  );
}
