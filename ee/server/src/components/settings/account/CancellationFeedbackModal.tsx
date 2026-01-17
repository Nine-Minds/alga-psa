'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';

interface CancellationFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasonText: string, reasonCategory?: string) => Promise<void>;
  onLogout?: () => Promise<void>;
}

const CANCELLATION_REASONS = [
  { value: 'Pricing too high', label: 'Pricing too high' },
  { value: 'Missing features I need', label: 'Missing features I need' },
  { value: 'Poor customer support', label: 'Poor customer support' },
  { value: 'Switching to competitor', label: 'Switching to competitor' },
  { value: 'No longer need the service', label: 'No longer need the service' },
  { value: 'Other', label: 'Other' },
];

export default function CancellationFeedbackModal({
  isOpen,
  onClose,
  onConfirm,
  onLogout,
}: CancellationFeedbackModalProps) {
  const [reasonText, setReasonText] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [loading, setLoading] = useState(false);

  const maxChars = 500;
  const remainingChars = maxChars - reasonText.length;

  const handleSubmit = async () => {
    if (!reasonText.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }

    if (reasonText.length > maxChars) {
      toast.error(`Feedback must be ${maxChars} characters or less`);
      return;
    }

    setLoading(true);
    try {
      await onConfirm(reasonText.trim(), reasonCategory || undefined);
      toast.success('Thank you for your feedback. We have received your cancellation request. You will be logged out shortly.');
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
      toast.error('Failed to submit feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setReasonText('');
    setReasonCategory('');
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title="Cancel Subscription" className="max-w-[600px]" id="cancellation-feedback-modal">
      <div className="space-y-6">
        {/* Warning */}
        <Alert variant="destructive" id="cancellation-warning-alert">
          <div>
            <p className="font-semibold">Before you cancel</p>
            <AlertDescription className="mt-1">
              We'd love to hear your feedback to help us improve our service. Your input is valuable to us.
            </AlertDescription>
          </div>
        </Alert>

        {/* Reason Category (Optional) */}
        <CustomSelect
          id="reason-category"
          label="Reason for Cancellation (Optional)"
          options={CANCELLATION_REASONS}
          value={reasonCategory}
          onValueChange={setReasonCategory}
          placeholder="Select a reason (optional)"
          disabled={loading}
          allowClear
        />

        {/* Feedback Text (Required) */}
        <div>
          <TextArea
            id="feedback-text"
            label="Why are you leaving us?"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="We'd love to hear your feedback so we can improve. Your input helps us serve our customers better."
            disabled={loading}
            maxLength={maxChars}
            required
            className="min-h-[120px]"
          />
          <div className="flex justify-between text-xs text-muted-foreground -mt-3 px-0.5">
            <span className="text-destructive">* Required</span>
            <span className={remainingChars < 50 ? 'text-destructive font-semibold' : ''}>
              {remainingChars} characters remaining
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            id="cancel-feedback-cancel-btn"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Keep Subscription
          </Button>
          <Button
            id="cancel-feedback-submit-btn"
            variant="default"
            onClick={handleSubmit}
            disabled={loading || !reasonText.trim()}
          >
            {loading ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
