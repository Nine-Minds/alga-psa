'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from 'react-i18next';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './ticket/TicketNotificationSuppressionControl';

interface BulkChangePriorityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  options: SelectOption[];
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (priorityId: string, options?: TicketNotificationSuppressionValue) => Promise<void>;
  idPrefix?: string;
}

export default function BulkChangePriorityDialog({
  isOpen,
  onClose,
  ticketCount,
  options,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-priority',
}: BulkChangePriorityDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [priorityId, setPriorityId] = useState<string>('');
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });

  useEffect(() => {
    if (isOpen) {
      setPriorityId('');
      setNotificationSuppression({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
    }
  }, [isOpen]);

  const canConfirm = !!priorityId;

  const handleConfirm = async () => {
    if (!priorityId) return;
    const options = notificationSuppression.suppressContactNotifications ? notificationSuppression : undefined;
    await (options ? onConfirm(priorityId, options) : onConfirm(priorityId));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.priority.dialogTitle', 'Change Priority for Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.priority.failedHeading', 'Priority could not be updated on the following tickets:')}
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
          {t('bulk.priority.message', 'Set the priority for {{count}} selected ticket(s):', { count: ticketCount })}
        </div>
        <div className="mb-4">
          <PrioritySelect
            id={`${idPrefix}-picker`}
            options={options}
            value={priorityId}
            onValueChange={setPriorityId}
            placeholder={t('bulk.priority.placeholder', 'Select a priority')}
            disabled={isSubmitting}
          />
        </div>
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
              ? t('bulk.priority.submitting', 'Updating...')
              : t('bulk.priority.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Update {{count}} Ticket' : 'Update {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
