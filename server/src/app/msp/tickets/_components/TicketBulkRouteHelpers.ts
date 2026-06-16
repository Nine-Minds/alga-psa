'use client';

import { useMemo } from 'react';
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
