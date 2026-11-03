import { getAllBoards } from '@alga-psa/tickets/actions/board-actions/boardActions';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import TicketImportDialogRouteClient from './TicketImportDialogRouteClient';

interface TicketImportRouteContentProps {
  closeMode: 'back' | 'replace';
}

export default async function TicketImportRouteContent({ closeMode }: TicketImportRouteContentProps) {
  const [initialBoards, initialUsers] = await Promise.all([
    getAllBoards(true),
    getAllUsersBasic(),
  ]);

  return (
    <TicketImportDialogRouteClient
      initialBoards={initialBoards}
      initialUsers={initialUsers}
      closeMode={closeMode}
    />
  );
}
