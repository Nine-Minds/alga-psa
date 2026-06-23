'use client';

import { useState } from 'react';
import BulkChangePriorityDialog from '@alga-psa/tickets/components/BulkChangePriorityDialog';
import { bulkUpdateTicketPriority } from '@alga-psa/tickets/actions/ticketActions';
import { useTicketsRouteState } from '@alga-psa/tickets/components/TicketsRouteProvider';
import {
  type TicketBulkCloseMode,
  type TicketBulkFailure,
  useTicketBulkRouteDialog,
} from './TicketBulkRouteHelpers';

interface BulkChangePriorityRouteClientProps {
  closeMode: TicketBulkCloseMode;
}

export default function BulkChangePriorityRouteClient({ closeMode }: BulkChangePriorityRouteClientProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState<TicketBulkFailure[]>([]);
  const { priorityOptions } = useTicketsRouteState();
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

  const handleConfirm = async (priorityId: string) => {
    if (selectedTicketIdsArray.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = await bulkUpdateTicketPriority(selectedTicketIdsArray, priorityId);

      if (result.updatedIds.length > 0) {
        refreshList();
      }

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        toastBulkResult(result, {
          partialFailure: t('bulk.priority.partialFailure', 'Priority could not be updated on some tickets'),
          success: (count) => t('bulk.priority.success', {
            count,
            defaultValue: count === 1 ? 'Priority updated on {{count}} ticket' : 'Priority updated on {{count}} tickets',
          }),
        });
      } else {
        toastBulkResult(result, {
          partialFailure: t('bulk.priority.partialFailure', 'Priority could not be updated on some tickets'),
          success: (count) => t('bulk.priority.success', {
            count,
            defaultValue: count === 1 ? 'Priority updated on {{count}} ticket' : 'Priority updated on {{count}} tickets',
          }),
        });
        refreshAndClose();
      }
    } catch (error) {
      handleError(error, t('bulk.priority.failure', 'Failed to update priority on selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BulkChangePriorityDialog
      idPrefix="ticket-bulk-priority"
      isOpen={true}
      onClose={close}
      ticketCount={selectedTicketCount}
      options={priorityOptions}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
