'use client';

import { useEffect, useState } from 'react';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import BulkChangeStatusDialog from '@alga-psa/tickets/components/BulkChangeStatusDialog';
import { bulkUpdateTicketStatus } from '@alga-psa/tickets/actions/ticketActions';
import { getBoardTicketStatuses } from '@alga-psa/tickets/actions/board-actions/boardTicketStatusActions';
import { useTicketsRouteState } from '@alga-psa/tickets/components/TicketsRouteProvider';
import {
  type TicketBulkCloseMode,
  type TicketBulkFailure,
  useTicketBulkRouteDialog,
} from './TicketBulkRouteHelpers';

interface BulkChangeStatusRouteClientProps {
  closeMode: TicketBulkCloseMode;
}

export default function BulkChangeStatusRouteClient({ closeMode }: BulkChangeStatusRouteClientProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState<TicketBulkFailure[]>([]);
  const [statuses, setStatuses] = useState<SelectOption[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(false);
  const { selectedTicketsSharedBoardId, isResolvingSelectedBoards } = useTicketsRouteState();
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

  useEffect(() => {
    if (isResolvingSelectedBoards || !selectedTicketsSharedBoardId) {
      setStatuses([]);
      setIsLoadingStatuses(false);
      return;
    }

    let cancelled = false;
    setIsLoadingStatuses(true);
    getBoardTicketStatuses(selectedTicketsSharedBoardId)
      .then((rows) => {
        if (cancelled) return;
        setStatuses(rows.map((status: { status_id: string; name: string }) => ({
          value: status.status_id,
          label: status.name,
        })));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[BulkChangeStatusRouteClient] Failed to load bulk status options:', error);
        setStatuses([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStatuses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isResolvingSelectedBoards, selectedTicketsSharedBoardId]);

  const handleConfirm = async (statusId: string) => {
    if (selectedTicketIdsArray.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = await bulkUpdateTicketStatus(selectedTicketIdsArray, statusId);

      if (result.updatedIds.length > 0) {
        refreshList();
      }

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        toastBulkResult(result, {
          partialFailure: t('bulk.status.partialFailure', 'Status could not be updated on some tickets'),
          success: (count) => t('bulk.status.success', {
            count,
            defaultValue: count === 1 ? 'Status updated on {{count}} ticket' : 'Status updated on {{count}} tickets',
          }),
        });
      } else {
        toastBulkResult(result, {
          partialFailure: t('bulk.status.partialFailure', 'Status could not be updated on some tickets'),
          success: (count) => t('bulk.status.success', {
            count,
            defaultValue: count === 1 ? 'Status updated on {{count}} ticket' : 'Status updated on {{count}} tickets',
          }),
        });
        refreshAndClose();
      }
    } catch (error) {
      handleError(error, t('bulk.status.failure', 'Failed to update status on selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BulkChangeStatusDialog
      idPrefix="ticket-bulk-status"
      isOpen={true}
      onClose={close}
      ticketCount={selectedTicketCount}
      statuses={statuses}
      isLoadingStatuses={isResolvingSelectedBoards || isLoadingStatuses}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
