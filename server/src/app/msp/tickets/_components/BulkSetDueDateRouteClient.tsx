'use client';

import { useState } from 'react';
import BulkSetDueDateDialog from '@alga-psa/tickets/components/BulkSetDueDateDialog';
import {
  bulkUpdateTicketDueDate,
  type TicketNotificationSuppressionOptions,
} from '@alga-psa/tickets/actions/ticketActions';
import {
  type TicketBulkCloseMode,
  type TicketBulkFailure,
  useTicketBulkRouteDialog,
} from './TicketBulkRouteHelpers';

interface BulkSetDueDateRouteClientProps {
  closeMode: TicketBulkCloseMode;
}

export default function BulkSetDueDateRouteClient({ closeMode }: BulkSetDueDateRouteClientProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState<TicketBulkFailure[]>([]);
  const {
    t,
    close,
    refreshList,
    refreshAndClose,
    handleError,
    selectedTicketCount,
    selectedTicketIdsArray,
    labelFailures,
    keepFailedSelection,
    toastBulkResult,
  } = useTicketBulkRouteDialog(closeMode);

  const handleConfirm = async (dueDateIso: string | null, options?: TicketNotificationSuppressionOptions) => {
    if (selectedTicketIdsArray.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = options
        ? await bulkUpdateTicketDueDate(selectedTicketIdsArray, dueDateIso, options)
        : await bulkUpdateTicketDueDate(selectedTicketIdsArray, dueDateIso);

      if (result.updatedIds.length > 0) {
        refreshList();
      }

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        toastBulkResult(result, {
          partialFailure: t('bulk.dueDate.partialFailure', 'Due date could not be updated on some tickets'),
          success: (count) => t('bulk.dueDate.success', {
            count,
            defaultValue: count === 1 ? 'Due date updated on {{count}} ticket' : 'Due date updated on {{count}} tickets',
          }),
        });
      } else {
        toastBulkResult(result, {
          partialFailure: t('bulk.dueDate.partialFailure', 'Due date could not be updated on some tickets'),
          success: (count) => t('bulk.dueDate.success', {
            count,
            defaultValue: count === 1 ? 'Due date updated on {{count}} ticket' : 'Due date updated on {{count}} tickets',
          }),
        });
        refreshAndClose();
      }
    } catch (error) {
      handleError(error, t('bulk.dueDate.failure', 'Failed to update due date on selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BulkSetDueDateDialog
      idPrefix="ticket-bulk-due-date"
      isOpen={true}
      onClose={close}
      ticketCount={selectedTicketCount}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
