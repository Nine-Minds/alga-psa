import { getServerSession } from 'next-auth';
import { getTicketsForList } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import TicketingDashboard from 'server/src/components/tickets/TicketingDashboard';

export default async function TicketsPage() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not found');
    }

    const tickets = await getTicketsForList(user, {
      channelFilterState: 'active'
    });
    return <TicketingDashboard initialTickets={tickets} />;
  } catch (error) {
    console.error('Error fetching user or tickets:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}
