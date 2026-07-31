'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useTicketsRouteState } from '@alga-psa/tickets/components/TicketsRouteProvider';

export type TicketBulkCloseMode = 'back' | 'replace';

export interface TicketBulkFailure {
  ticketId: string;
  message: string;
}

export interface TicketBulkResult {
  updatedIds: string[];
  failed: TicketBulkFailure[];
}

export function useTicketBulkRouteDialog(closeMode: TicketBulkCloseMode) {
  const router = useRouter();
  const { t } = useTranslation(['features/tickets', 'common']);
  const {
    selectedTicketIds,
    selectedTicketIdsArray,
    selectedTicketDetails,
    setSelectedTicketIds,
    selectionHydrated,
  } = useTicketsRouteState();

  const ticketLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const detail of selectedTicketDetails) {
      map.set(detail.ticket_id, detail.ticket_number ?? detail.title ?? detail.ticket_id);
    }
    return map;
  }, [selectedTicketDetails]);

  const close = () => {
    if (closeMode === 'back') {
      router.back();
      return;
    }
    router.replace('/msp/tickets');
  };

  // A bulk dialog with no selection is meaningless. This happens on a hard load/reload of
  // the route once there is genuinely nothing selected (e.g. storage cleared, or the URL
  // visited directly). Wait for selectionHydrated so we don't bounce away before the
  // persisted selection is restored from sessionStorage on mount.
  useEffect(() => {
    if (selectionHydrated && selectedTicketIds.size === 0) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionHydrated, selectedTicketIds.size]);

  const refreshAndClose = () => {
    router.refresh();
    close();
  };

  const refreshList = () => {
    router.refresh();
  };

  const labelFailures = (failed: TicketBulkFailure[]) => failed.map((error) => ({
    ...error,
    label: ticketLabelById.get(error.ticketId),
  }));

  const keepFailedSelection = (failed: TicketBulkFailure[]) => {
    setSelectedTicketIds(() => new Set(failed.map((item) => item.ticketId)));
  };

  const toastBulkResult = (
    result: TicketBulkResult,
    messages: {
      partialFailure: string;
      success: (count: number) => string;
    },
  ) => {
    if (result.failed.length > 0) {
      toast.error(messages.partialFailure);
    }
    if (result.updatedIds.length > 0) {
      toast.success(messages.success(result.updatedIds.length));
    }
  };

  return {
    t,
    close,
    refreshList,
    refreshAndClose,
    handleError,
    selectedTicketCount: selectedTicketIds.size,
    selectedTicketIdsArray,
    labelFailures,
    keepFailedSelection,
    toastBulkResult,
  };
}
