import { redirect } from 'next/navigation';
import { DEFAULT_CUSTOMER_TICKETS_HREF } from '@/lib/co-managed/ticketListReturn';

/**
 * The Customer Tickets queue lives at /msp/tickets/customer. This dark route only forwards there; the
 * destination page holds the capability gate, so nothing is revealed or bypassed here.
 */
export default function CoManagedCustomerTicketsRedirect(): never {
  redirect(DEFAULT_CUSTOMER_TICKETS_HREF);
}
