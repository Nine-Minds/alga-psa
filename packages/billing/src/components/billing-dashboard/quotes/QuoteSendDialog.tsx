'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { QuoteSendRecipientsField, type QuoteRecipient } from './QuoteSendRecipientsField';

export interface QuoteSendDialogPayload {
  email_addresses?: string[];
  message?: string;
}

interface QuoteSendDialogProps {
  /** Stable prefix for the dialog and its control IDs (e.g. `quote-send`). */
  idPrefix: string;
  isOpen: boolean;
  /** Client whose active contacts the recipient picker loads. */
  clientId: string | null | undefined;
  isSending: boolean;
  onClose: () => void;
  onConfirm: (payload: QuoteSendDialogPayload) => void;
}

/**
 * The single send dialog used by the quote list and the read-only quote detail.
 * It owns the draft fields and the recipient merge; the parent keeps the
 * `sendQuote` call, permission/status handling, notices, and refresh behavior.
 */
export function QuoteSendDialog({
  idPrefix,
  isOpen,
  clientId,
  isSending,
  onClose,
  onConfirm,
}: QuoteSendDialogProps): React.JSX.Element {
  const { t } = useTranslation('msp/quotes');
  const [recipients, setRecipients] = useState<QuoteRecipient[]>([]);
  const [additionalEmails, setAdditionalEmails] = useState('');
  const [message, setMessage] = useState('');

  // A closed dialog is a finished draft: never let one quote's selections or
  // message surface when the next send opens. A failed send leaves the dialog
  // open and keeps the operator's selections.
  useEffect(() => {
    if (isOpen) return;
    setRecipients([]);
    setAdditionalEmails('');
    setMessage('');
  }, [isOpen]);

  // A different client means a different recipient universe; drop anything
  // drafted for the previous quote.
  useEffect(() => {
    setRecipients([]);
    setAdditionalEmails('');
    setMessage('');
  }, [clientId]);

  const handleConfirm = () => {
    const typedEmails = additionalEmails
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
    // Picked recipients win on a case-insensitive collision, and the first
    // spelling/order is preserved.
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const email of [...recipients.map((recipient) => recipient.email), ...typedEmails]) {
      const normalized = email.trim();
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(normalized);
    }

    onConfirm({
      email_addresses: combined.length > 0 ? combined : undefined,
      message: message.trim() || undefined,
    });
  };

  return (
    <Dialog
      id={`${idPrefix}-dialog`}
      isOpen={isOpen}
      onClose={onClose}
      title={t('quoteForm.dialogs.send.title', { defaultValue: 'Send Quote to Client' })}
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="outline" onClick={onClose} disabled={isSending}>
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSending}>
            {isSending
              ? t('common.states.sending', { defaultValue: 'Sending...' })
              : t('quoteForm.actions.sendQuote', { defaultValue: 'Send Quote' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <DialogDescription>
          {t('quoteForm.dialogs.send.description', {
            defaultValue:
              'This will email the quote to the client\'s billing contacts and change its status to "Sent".',
          })}
        </DialogDescription>
        <div className="space-y-3 py-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('quoteForm.fields.recipients', { defaultValue: 'Recipients' })}
            <QuoteSendRecipientsField
              id={`${idPrefix}-recipients`}
              clientId={clientId}
              value={recipients}
              onChange={setRecipients}
              disabled={isSending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('quoteForm.fields.additionalEmails', {
              defaultValue: 'Additional email addresses (comma-separated)',
            })}
            <Input
              id={`${idPrefix}-additional-emails`}
              value={additionalEmails}
              onChange={(event) => setAdditionalEmails(event.target.value)}
              placeholder={t('quoteForm.placeholders.additionalEmails', {
                defaultValue: 'email@example.com, another@example.com',
              })}
              disabled={isSending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('quoteForm.fields.messageOptional', { defaultValue: 'Message (optional)' })}
            <TextArea
              id={`${idPrefix}-message`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder={t('quoteForm.placeholders.message', {
                defaultValue: 'Add a personal note for the client...',
              })}
              disabled={isSending}
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
