'use client';

import { useRouter } from 'next/navigation';
import TicketImportDialog from '@alga-psa/tickets/components/TicketImportDialog';
import type { IBoard, IClient, IUser } from '@alga-psa/types';

interface TicketImportDialogRouteClientProps {
  initialBoards: IBoard[];
  initialClients: IClient[];
  initialUsers?: IUser[];
  closeMode: 'back' | 'replace';
}

export default function TicketImportDialogRouteClient({
  initialBoards,
  initialClients,
  initialUsers,
  closeMode,
}: TicketImportDialogRouteClientProps) {
  const router = useRouter();
  const close = () => {
    if (closeMode === 'back') {
      router.back();
      return;
    }
    router.replace('/msp/tickets');
  };

  return (
    <TicketImportDialog
      isOpen={true}
      onClose={close}
      initialBoards={initialBoards}
      initialClients={initialClients}
      initialUsers={initialUsers}
      onImportComplete={() => {
        router.refresh();
        close();
      }}
    />
  );
}
