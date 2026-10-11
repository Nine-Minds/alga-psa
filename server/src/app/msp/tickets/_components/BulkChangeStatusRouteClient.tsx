'use client';

import { useEffect, useState } from 'react';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import BulkChangeStatusDialog from '@alga-psa/tickets/components/BulkChangeStatusDialog';
import {
  bulkUpdateTicketStatus,
  type TicketBulkStatusOptions,
} from '@alga-psa/tickets/actions/ticketActions';
import { getBoardTicketStatuses } from '@alga-psa/tickets/actions/board-actions/boardTicketStatusActions';
import { getBoardCloseRules } from '@alga-psa/tickets/actions/close-rules/closeRuleActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
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
  const [closedStatusIds, setClosedStatusIds] = useState<string[]>([]);
  const [resolutionRequired, setResolutionRequired] = useState(false);
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
      setClosedStatusIds([]);
      setResolutionRequired(false);
      setIsLoadingStatuses(false);
      return;
    }

    let cancelled = false;
    setIsLoadingStatuses(true);
    // A board change must not carry the previous board's requirement forward.
    setResolutionRequired(false);

    // Close rules only drive the required-field UX; a failure there must never
    // blank the status list or toast, the server still enforces.
    Promise.allSettled([
      getBoardTicketStatuses(selectedTicketsSharedBoardId),
      getBoardCloseRules(selectedTicketsSharedBoardId),
    ]).then(([statusResult, rulesResult]) => {
      if (cancelled) return;

      if (statusResult.status === 'rejected') {
        console.error('[BulkChangeStatusRouteClient] Failed to load bulk status options:', statusResult.reason);
        setStatuses([]);
        setClosedStatusIds([]);
      } else {
        const rows = statusResult.value;
        if (isActionMessageError(rows) || isActionPermissionError(rows)) {
          handleError(rows, getErrorMessage(rows));
          setStatuses([]);
          setClosedStatusIds([]);
        } else {
          setStatuses(rows.map((status: { status_id: string; name: string }) => ({
            value: status.status_id,
            label: status.name,
          })));
          setClosedStatusIds(
            rows
              .filter((status: { is_closed?: boolean }) => !!status.is_closed)
              .map((status: { status_id: string }) => status.status_id),
          );
        }
      }

      if (rulesResult.status === 'rejected') {
        console.error('[BulkChangeStatusRouteClient] Failed to load board close rules:', rulesResult.reason);
        setResolutionRequired(false);
      } else if (isActionMessageError(rulesResult.value) || isActionPermissionError(rulesResult.value)) {
        console.error('[BulkChangeStatusRouteClient] Board close rules unavailable:', rulesResult.value);
        setResolutionRequired(false);
      } else {
        // Mirrors the server gate: rules only apply when enabled.
        setResolutionRequired(
          !!rulesResult.value.is_enabled && !!rulesResult.value.require_resolution_comment,
        );
      }
      setIsLoadingStatuses(false);
    });

    return () => {
      cancelled = true;
    };
  }, [handleError, isResolvingSelectedBoards, selectedTicketsSharedBoardId]);

  const handleConfirm = async (
    statusId: string,
    options?: TicketBulkStatusOptions,
  ) => {
    if (selectedTicketIdsArray.length === 0) return;

    setIsSubmitting(true);
    setFailed([]);

    try {
      const result = options
        ? await bulkUpdateTicketStatus(selectedTicketIdsArray, statusId, options)
        : await bulkUpdateTicketStatus(selectedTicketIdsArray, statusId);

      if (result.failed.length > 0) {
        setFailed(result.failed);
        keepFailedSelection(result.failed);
        if (result.updatedIds.length > 0) {
          refreshList();
        }
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
      ticketIds={selectedTicketIdsArray}
      statuses={statuses}
      closedStatusIds={closedStatusIds}
      resolutionRequired={resolutionRequired}
      isLoadingStatuses={isResolvingSelectedBoards || isLoadingStatuses}
      failed={labelFailures(failed)}
      isSubmitting={isSubmitting}
      onConfirm={handleConfirm}
    />
  );
}
