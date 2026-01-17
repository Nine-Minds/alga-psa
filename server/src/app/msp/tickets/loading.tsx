import TicketListSkeleton from '@alga-psa/tickets/components/TicketListSkeleton';

export default function TicketsLoading() {
  return (
    <div id="tickets-page-container" className="bg-gray-100">
      <TicketListSkeleton />
    </div>
  );
}
