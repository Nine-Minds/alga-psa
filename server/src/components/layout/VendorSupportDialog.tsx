'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { analytics } from '@alga-psa/analytics/client';
import {
  submitVendorSupportRequest,
  type VendorSupportRequestError,
} from '@/lib/actions/vendorSupportActions';

export const VENDOR_SUPPORT_FALLBACK_URL = 'https://www.nineminds.com/support';

type SupportCategory = 'bug' | 'question' | 'billing' | 'feature';

type VendorSupportTranslator = (key: string, options?: Record<string, unknown>) => string;

interface VendorSupportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  t: VendorSupportTranslator;
}

const CATEGORY_OPTIONS: { value: SupportCategory; labelKey: string; labelDefault: string }[] = [
  { value: 'bug', labelKey: 'header.supportDialog.categories.bug', labelDefault: 'Something is broken' },
  { value: 'question', labelKey: 'header.supportDialog.categories.question', labelDefault: 'Question' },
  { value: 'billing', labelKey: 'header.supportDialog.categories.billing', labelDefault: 'Billing' },
  { value: 'feature', labelKey: 'header.supportDialog.categories.feature', labelDefault: 'Feature request' },
];

const ERROR_LABELS: Record<VendorSupportRequestError, { key: string; defaultValue: string }> = {
  invalid_input: {
    key: 'header.supportDialog.errors.invalidInput',
    defaultValue: 'Add a subject of at least 3 characters and a description of at least 20 characters.',
  },
  rate_limited: {
    key: 'header.supportDialog.errors.rateLimited',
    defaultValue: 'You just sent a request. Please wait a minute before sending another.',
  },
  email_not_configured: {
    key: 'header.supportDialog.errors.emailNotConfigured',
    defaultValue: 'This install has no outbound email configured, so the request could not be sent.',
  },
  send_failed: {
    key: 'header.supportDialog.errors.sendFailed',
    defaultValue: 'Sending the request failed. Please try again.',
  },
};

export const VendorSupportDialog: React.FC<VendorSupportDialogProps> = ({
  isOpen,
  onClose,
  userEmail,
  t,
}) => {
  const pathname = usePathname();
  const [category, setCategory] = useState<SupportCategory>('bug');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<VendorSupportRequestError | null>(null);

  const replyEmail = userEmail ?? '';

  const handleClose = () => {
    setSubmitting(false);
    setSent(false);
    setError(null);
    setSubject('');
    setDescription('');
    setCategory('bug');
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    let outcome: 'sent' | VendorSupportRequestError = 'sent';
    try {
      const result = await submitVendorSupportRequest({
        category,
        subject,
        description,
        pageUrl: pathname ?? '',
      });

      if (result.success === true) {
        setSent(true);
      } else {
        outcome = result.error;
        setError(result.error);
      }
    } catch {
      outcome = 'send_failed';
      setError('send_failed');
    } finally {
      setSubmitting(false);
      analytics.capture('vendor_support.request_submitted', { category, outcome });
    }
  };

  const errorLabel = error ? ERROR_LABELS[error] : null;

  return (
    <Dialog
      id="vendor-support"
      isOpen={isOpen}
      onClose={handleClose}
      title={t('header.supportDialog.title', { defaultValue: 'Submit a ticket to Nine Minds' })}
    >
      <DialogContent>
        {sent ? (
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {t('header.supportDialog.success', {
              defaultValue: 'Sent to Nine Minds support. Replies go to {{email}}.',
              email: replyEmail,
            })}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('header.supportDialog.intro', {
                defaultValue: 'Nine Minds support receives this as a ticket and replies by email.',
              })}
            </p>
            <CustomSelect
              id="vendor-support-category"
              label={t('header.supportDialog.categoryLabel', { defaultValue: 'What do you need help with?' })}
              value={category}
              onValueChange={(value) => setCategory(value as SupportCategory)}
              options={CATEGORY_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { defaultValue: option.labelDefault }),
              }))}
            />
            <Input
              id="vendor-support-subject"
              label={t('header.supportDialog.subjectLabel', { defaultValue: 'Subject' })}
              value={subject}
              required
              maxLength={120}
              onChange={(event) => setSubject(event.target.value)}
            />
            <TextArea
              id="vendor-support-description"
              label={t('header.supportDialog.descriptionLabel', { defaultValue: 'What happened?' })}
              value={description}
              required
              rows={6}
              maxLength={5000}
              placeholder={t('header.supportDialog.descriptionPlaceholder', {
                defaultValue: 'Include what you expected, what happened, and any client or invoice involved.',
              })}
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('header.supportDialog.replyTo', {
                defaultValue: 'Replies go to {{email}}',
                email: replyEmail,
              })}
            </p>
          </div>
        )}
        {errorLabel ? (
          <div className="mt-4 rounded-md border border-destructive bg-alert-destructive-bg p-3 text-sm text-[rgb(var(--color-text-800))]">
            <p>{t(errorLabel.key, { defaultValue: errorLabel.defaultValue })}</p>
            <a
              id="vendor-support-fallback-link"
              href={VENDOR_SUPPORT_FALLBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block underline"
            >
              {t('header.supportDialog.fallbackLink', { defaultValue: 'Contact support on nineminds.com' })}
            </a>
          </div>
        ) : null}
      </DialogContent>
      <DialogFooter>
        <Button id="vendor-support-close" variant="ghost" onClick={handleClose}>
          {sent
            ? t('header.supportDialog.close', { defaultValue: 'Close' })
            : t('header.supportDialog.cancel', { defaultValue: 'Cancel' })}
        </Button>
        {sent ? null : (
          <Button
            id="vendor-support-submit"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? t('header.supportDialog.sending', { defaultValue: 'Sending…' })
              : t('header.supportDialog.submit', { defaultValue: 'Send to Nine Minds' })}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default VendorSupportDialog;
