'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from 'react-i18next';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './ticket/TicketNotificationSuppressionControl';

interface BulkChangeStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  statuses: SelectOption[];
  isLoadingStatuses: boolean;
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (statusId: string, options?: TicketNotificationSuppressionValue) => Promise<void>;
  idPrefix?: string;
}

export default function BulkChangeStatusDialog({
  isOpen,
  onClose,
  ticketCount,
  statuses,
  isLoadingStatuses,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-status',
}: BulkChangeStatusDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [selectedStatusId, setSelectedStatusId] = useState<string>('');
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedStatusId('');
      setNotificationSuppression({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
    }
  }, [isOpen]);

  const canConfirm = !!selectedStatusId && !isLoadingStatuses;

  const handleConfirm = async () => {
    if (!selectedStatusId) return;
    const options = notificationSuppression.suppressContactNotifications ? notificationSuppression : undefined;
    await (options ? onConfirm(selectedStatusId, options) : onConfirm(selectedStatusId));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.status.dialogTitle', 'Change Status for Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.status.failedHeading', 'Status could not be updated on the following tickets:')}
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
          {t('bulk.status.message', 'Set the status for {{count}} selected ticket(s):', { count: ticketCount })}
        </div>
        <div className="mb-4">
          <CustomSelect
            id={`${idPrefix}-picker`}
            options={statuses}
            value={selectedStatusId}
            onValueChange={setSelectedStatusId}
            placeholder={
              isLoadingStatuses
                ? t('bulk.status.loading', 'Loading statuses...')
                : t('bulk.status.placeholder', 'Select a status')
            }
            disabled={isLoadingStatuses || isSubmitting}
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
              ? t('bulk.status.submitting', 'Updating...')
              : t('bulk.status.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Update {{count}} Ticket' : 'Update {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
