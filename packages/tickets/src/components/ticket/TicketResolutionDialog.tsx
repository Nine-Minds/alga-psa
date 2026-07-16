'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketResolutionDialogProps {
  id: string;
  isOpen: boolean;
  statusOptions: { value: string; label: string }[];
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (statusId: string, resolution: string) => void;
}

export default function TicketResolutionDialog({
  id,
  isOpen,
  statusOptions,
  isSubmitting = false,
  onClose,
  onConfirm,
}: TicketResolutionDialogProps) {
  const { t } = useTranslation('features/tickets');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const formId = `${id}-form`;
  const resolutionLabel = t('conversation.resolution', 'Resolution');

  useEffect(() => {
    if (isOpen) {
      setStatusId(statusOptions.length === 1 ? statusOptions[0].value : null);
      setResolution('');
    }
  }, [isOpen, statusOptions]);

  const trimmedResolution = resolution.trim();
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!statusId || !trimmedResolution || isSubmitting) return;
    onConfirm(statusId, trimmedResolution);
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id={`${id}-cancel`}
        type="button"
        variant="ghost"
        onClick={onClose}
        disabled={isSubmitting}
      >
        {t('actions.cancel', 'Cancel')}
      </Button>
      <Button
        id={`${id}-confirm`}
        type="button"
        disabled={!statusId || !trimmedResolution || isSubmitting}
        onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSubmitting
          ? t('info.closing', 'Closing…')
          : t('info.resolveAndClose', 'Resolve and close')}
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
        <form id={formId} className="space-y-4" onSubmit={handleSubmit}>
          <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
            {t(
              'info.closeTicketResolutionPrompt',
              'Choose a close status and add a resolution for this ticket.',
            )}
          </p>
          <CustomSelect
            id={`${id}-status`}
            label={t('conversation.closeStatus', 'Close status')}
            value={statusId}
            options={statusOptions}
            onValueChange={setStatusId}
            placeholder={t('info.selectCloseStatus', 'Select a close status')}
            required
            disabled={isSubmitting}
          />
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
            disabled={isSubmitting}
            wrapperClassName="mb-0"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
