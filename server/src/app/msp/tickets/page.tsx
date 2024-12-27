import { getServerSession } from 'next-auth';
import { getTicketsForList } from '@/lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import TicketingDashboard from '@/components/tickets/TicketingDashboard';

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
