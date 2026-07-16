'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketResolutionDialogProps {
  id: string;
  isOpen: boolean;
  statusLabel?: string;
  onClose: () => void;
  onConfirm: (resolution: string) => void;
}

export default function TicketResolutionDialog({
  id,
  isOpen,
  statusLabel,
  onClose,
  onConfirm,
}: TicketResolutionDialogProps) {
  const { t } = useTranslation('features/tickets');
  const [resolution, setResolution] = useState('');
  const formId = `${id}-form`;
  const resolutionLabel = t('conversation.resolution', 'Resolution');

  useEffect(() => {
    if (isOpen) {
      setResolution('');
    }
  }, [isOpen]);

  const trimmedResolution = resolution.trim();
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedResolution) return;
    onConfirm(trimmedResolution);
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id={`${id}-cancel`}
        type="button"
        variant="ghost"
        onClick={onClose}
      >
        {t('actions.cancel', 'Cancel')}
      </Button>
      <Button
        id={`${id}-confirm`}
        type="button"
        disabled={!trimmedResolution}
        onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
      >
        {t('info.resolveAndClose', 'Resolve and close')}
      </Button>
    </div>
  );

  return (
    <Dialog
      id={id}
      isOpen={isOpen}
      onClose={onClose}
      title={t('info.closeTicketTitle', 'Close ticket')}
      className="max-w-lg"
      footer={footer}
    >
      <DialogContent>
        <form id={formId} onSubmit={handleSubmit}>
          <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
            {statusLabel
              ? t(
                  'info.closeTicketResolutionPromptWithStatus',
                  'Add a resolution before moving this ticket to {{status}}.',
                  { status: statusLabel },
                )
              : t(
                  'info.closeTicketResolutionPrompt',
                  'Add a resolution before closing this ticket.',
                )}
          </p>
          <TextArea
            id={`${id}-resolution`}
            label={resolutionLabel}
            aria-label={resolutionLabel}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            placeholder={t(
              'info.closeTicketResolutionPlaceholder',
              'Summarize the resolution for the ticket history and customer.',
            )}
            rows={4}
            required
            autoFocus
            wrapperClassName="mt-2 mb-0"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
