import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import BulkAssignTicketsRouteClient from './BulkAssignTicketsRouteClient';
import type { TicketBulkCloseMode } from './TicketBulkRouteHelpers';

interface BulkAssignTicketsRouteContentProps {
  closeMode: TicketBulkCloseMode;
}

export default async function BulkAssignTicketsRouteContent({ closeMode }: BulkAssignTicketsRouteContentProps) {
  const users = await getAllUsersBasic();

  return (
    <BulkAssignTicketsRouteClient
      closeMode={closeMode}
      users={users}
    />
  );
}
