'use client';

import React, { useState, useEffect } from 'react';
import TicketDetails from 'server/src/components/tickets/TicketDetails';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getTicketData } from './actions';

export default function TicketPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: session } = useSession();
  const userId = session?.user?.id || '';

  const [ticket, setTicket] = useState<(ITicket & { tenant: string | undefined }) | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { ticket: ticketData, error: fetchError } = await getTicketData(id);
        
        if (fetchError) {
          setError(fetchError);
        } else {
          setTicket(ticketData);
        }
      } catch (error) {
        console.error(`Error fetching ticket with id ${id}:`, error);
        setError(`Failed to load ticket data: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return <div id="ticket-loading-indicator">Loading...</div>;
  }

  if (error) {
    return <div id="ticket-error-message">Error: {error}</div>;
  }

  if (!ticket) {
    return <div id="ticket-not-found-message">Ticket not found</div>;
  }

  const router = useRouter();
  
  return (
    <div id="ticket-details-container" className="bg-gray-100">
      <TicketDetails
        initialTicket={ticket}
        onClose={() => router.back()}
      />
    </div>
  );
}
