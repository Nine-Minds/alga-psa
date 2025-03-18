import TicketListSkeleton from 'server/src/components/tickets/TicketListSkeleton';

export default function TicketsLoading() {
  return (
    <div id="tickets-page-container" className="bg-gray-100">
      <TicketListSkeleton />
    </div>
  );
}