import React from 'react';
import Link from 'next/link';

interface ServiceRequestTicketLinkProps {
  ticketId?: string | null;
  ticketNumber?: string | null;
  labels: {
    /** Link text used when the ticket exists but its number did not resolve. */
    viewTicket: string;
  };
}

/**
 * Ticket reference for client-portal service requests. Hook-free so it can be
 * rendered from both server and client components; labels arrive as props.
 */
export function ServiceRequestTicketLink({ ticketId, ticketNumber, labels }: ServiceRequestTicketLinkProps) {
  if (!ticketId) {
    return null;
  }

  return (
    <Link
      href={`/client-portal/tickets/${ticketId}`}
      className="text-[rgb(var(--color-primary-600))] hover:underline"
    >
      {ticketNumber ? `#${ticketNumber}` : labels.viewTicket}
    </Link>
  );
}
