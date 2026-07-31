'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Calendar } from '@alga-psa/ui/components/Calendar';
import { useTranslation } from 'react-i18next';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './ticket/TicketNotificationSuppressionControl';

interface BulkSetDueDateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (dueDateIso: string | null, options?: TicketNotificationSuppressionValue) => Promise<void>;
  idPrefix?: string;
}

export default function BulkSetDueDateDialog({
  isOpen,
  onClose,
  ticketCount,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-due-date',
}: BulkSetDueDateDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [mode, setMode] = useState<'set' | 'clear'>('set');
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });

  useEffect(() => {
    if (isOpen) {
      setDate(undefined);
      setMode('set');
      setNotificationSuppression({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
    }
  }, [isOpen]);

  const canConfirm = mode === 'clear' || (mode === 'set' && !!date);

  const handleConfirm = async () => {
    const options = notificationSuppression.suppressContactNotifications ? notificationSuppression : undefined;
    if (mode === 'clear') {
      await (options ? onConfirm(null, options) : onConfirm(null));
      return;
    }
    if (!date) return;
    const dueDateIso = date.toISOString();
    await (options ? onConfirm(dueDateIso, options) : onConfirm(dueDateIso));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.dueDate.dialogTitle', 'Set Due Date for Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.dueDate.failedHeading', 'Due date could not be updated on the following tickets:')}
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
          {t('bulk.dueDate.message', 'Set or clear the due date on {{count}} selected ticket(s).', { count: ticketCount })}
        </div>
        <div className="mb-4 flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              checked={mode === 'set'}
              onChange={() => setMode('set')}
              disabled={isSubmitting}
            />
            {t('bulk.dueDate.modeSet', 'Set to')}
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              checked={mode === 'clear'}
              onChange={() => setMode('clear')}
              disabled={isSubmitting}
            />
            {t('bulk.dueDate.modeClear', 'Clear due date')}
          </label>
        </div>
        {mode === 'set' && (
          <div className="mb-4 flex justify-center">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(next) => setDate(next)}
              onClear={() => setDate(undefined)}
            />
          </div>
        )}
        <div className="mb-4">
          <TicketNotificationSuppressionControl
            idPrefix={`${idPrefix}-notification-suppression`}
            value={notificationSuppression}
            onChange={setNotificationSuppression}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSubmitting || !canConfirm}>
            {isSubmitting
              ? t('bulk.dueDate.submitting', 'Updating...')
              : t('bulk.dueDate.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Update {{count}} Ticket' : 'Update {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
