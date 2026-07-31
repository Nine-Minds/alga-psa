import { getAllBoards } from '@alga-psa/tickets/actions/board-actions/boardActions';
import { getAllClients } from '@alga-psa/tickets/actions/clientLookupActions';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import TicketImportDialogRouteClient from './TicketImportDialogRouteClient';

interface TicketImportRouteContentProps {
  closeMode: 'back' | 'replace';
}

export default async function TicketImportRouteContent({ closeMode }: TicketImportRouteContentProps) {
  const [initialBoards, initialClients, initialUsers] = await Promise.all([
    getAllBoards(true),
    getAllClients(true),
    getAllUsersBasic(),
  ]);

  return (
    <TicketImportDialogRouteClient
      initialBoards={initialBoards}
      initialClients={initialClients}
      initialUsers={initialUsers}
      closeMode={closeMode}
    />
  );
}
