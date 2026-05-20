'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { QuickAddTagPicker } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

interface BulkAddTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (tagTexts: string[]) => Promise<void>;
  idPrefix?: string;
}

export default function BulkAddTagsDialog({
  isOpen,
  onClose,
  ticketCount,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-add-tags',
}: BulkAddTagsDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);

  useEffect(() => {
    if (isOpen) setPendingTags([]);
  }, [isOpen]);

  const trimmedTexts = Array.from(
    new Set(pendingTags.map((tag) => tag.tag_text.trim()).filter((text) => text.length > 0)),
  );
  const hasTags = trimmedTexts.length > 0;

  const handleConfirm = async () => {
    if (!hasTags) return;
    await onConfirm(trimmedTexts);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.tags.dialogTitle', 'Add Tags to Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.tags.failedHeading', 'Tags could not be added to the following tickets:')}
              </p>
              <ul className="mt-2 space-y-1">
                {failed.map((error) => (
                  <li key={error.ticketId}>
                    <span className="font-medium">{error.label ?? error.ticketId}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="mb-3 text-sm text-gray-600">
          {t(
            'bulk.tags.message',
            'Add one or more tags to {{count}} selected ticket(s). Tags already on a ticket are skipped.',
            { count: ticketCount },
          )}
        </div>
        <div className="mb-4">
          <QuickAddTagPicker
            id={`${idPrefix}-picker`}
            entityType="ticket"
            pendingTags={pendingTags}
            onPendingTagsChange={setPendingTags}
            placeholder={t('bulk.tags.placeholder', 'Type a tag and press Enter')}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSubmitting || !hasTags}>
            {isSubmitting
              ? t('bulk.tags.submitting', 'Adding tags...')
              : t('bulk.tags.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Add Tags to {{count}} Ticket' : 'Add Tags to {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
