'use client';

import { useState } from 'react';
import type { IUser } from '@alga-psa/types';
import BulkAssignTicketsDialog from '@alga-psa/tickets/components/BulkAssignTicketsDialog';
import {
  bulkAssignTickets,
  type BulkTicketAssignSelection,
  type TicketNotificationSuppressionOptions,
} from '@alga-psa/tickets/actions/ticketActions';
import {
  type TicketBulkCloseMode,
  type TicketBulkFailure,
  useTicketBulkRouteDialog,
} from './TicketBulkRouteHelpers';

interface BulkAssignTicketsRouteClientProps {
  closeMode: TicketBulkCloseMode;
  users: IUser[];
}

export default function BulkAssignTicketsRouteClient({
  closeMode,
  users,
}: BulkAssignTicketsRouteClientProps) {
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

  const handleConfirm = async (
    selection: BulkTicketAssignSelection,
    options?: TicketNotificationSuppressionOptions
  ) => {
    if (selectedTicketIdsArray.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = options
        ? await bulkAssignTickets(selectedTicketIdsArray, selection, options)
        : await bulkAssignTickets(selectedTicketIdsArray, selection);

      if (result.updatedIds.length > 0) {
        refreshList();
      }

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        toastBulkResult(result, {
          partialFailure: t('bulk.assign.partialFailure', 'Some tickets could not be reassigned'),
          success: (count) => t('bulk.assign.success', {
            count,
            defaultValue: count === 1 ? '{{count}} ticket reassigned' : '{{count}} tickets reassigned',
          }),
        });
      } else {
        toastBulkResult(result, {
          partialFailure: t('bulk.assign.partialFailure', 'Some tickets could not be reassigned'),
          success: (count) => t('bulk.assign.success', {
            count,
            defaultValue: count === 1 ? '{{count}} ticket reassigned' : '{{count}} tickets reassigned',
          }),
        });
        refreshAndClose();
      }
    } catch (error) {
      handleError(error, t('bulk.assign.failure', 'Failed to reassign selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BulkAssignTicketsDialog
      idPrefix="ticket-bulk-assign"
      isOpen={true}
      onClose={close}
      ticketCount={selectedTicketCount}
      users={users}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
