'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QuoteMarkAcceptedDialogProps {
  isOpen: boolean;
  isWorking: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * MSP-side "Mark as accepted" confirmation for a sent quote (client accepted outside the
 * portal). Records who/when server-side; the optional note is kept on the activity.
 */
const QuoteMarkAcceptedDialog: React.FC<QuoteMarkAcceptedDialogProps> = ({
  isOpen,
  isWorking,
  note,
  onNoteChange,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation('msp/quotes');

  return (
    <Dialog
      id="quote-mark-accepted-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('quoteForm.dialogs.markAccepted.title', { defaultValue: 'Mark Quote as Accepted' })}
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id="quote-mark-accepted-cancel" variant="outline" onClick={onClose} disabled={isWorking}>
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="quote-mark-accepted-confirm" onClick={onConfirm} disabled={isWorking}>
            {isWorking
              ? t('quoteForm.dialogs.approval.processing', { defaultValue: 'Processing...' })
              : t('common.actions.markAccepted', { defaultValue: 'Mark as accepted' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <DialogDescription>
          {t('quoteForm.dialogs.markAccepted.description', {
            defaultValue: 'Record that the client accepted this quote outside the client portal (for example by phone or email). The quote moves to Accepted and can be converted like any accepted quote. Your name and the time are recorded.',
          })}
        </DialogDescription>
        <div className="space-y-3 py-2">
          <label htmlFor="quote-mark-accepted-note" className="flex flex-col gap-1 text-sm font-medium">
            {t('quoteForm.dialogs.markAccepted.note', { defaultValue: 'Note (optional)' })}
            <TextArea
              id="quote-mark-accepted-note"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={3}
              placeholder={t('quoteForm.dialogs.markAccepted.notePlaceholder', {
                defaultValue: 'For example: Accepted by email on the 3rd',
              })}
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuoteMarkAcceptedDialog;
