'use client';

import { useRouter } from 'next/navigation';
import TicketExportDialog from '@alga-psa/tickets/components/TicketExportDialog';
import { useTicketsRouteState } from '@alga-psa/tickets/components/TicketsRouteProvider';

interface TicketExportDialogRouteClientProps {
  closeMode: 'back' | 'replace';
}

export default function TicketExportDialogRouteClient({ closeMode }: TicketExportDialogRouteClientProps) {
  const router = useRouter();
  const { filters, totalCount, selectedTicketIdsArray } = useTicketsRouteState();
  const close = () => {
    if (closeMode === 'back') {
      router.back();
      return;
    }
    router.replace('/msp/tickets');
  };

  return (
    <TicketExportDialog
      isOpen={true}
      onClose={close}
      filters={filters}
      totalCount={totalCount}
      selectedTicketIds={selectedTicketIdsArray}
    />
  );
}
