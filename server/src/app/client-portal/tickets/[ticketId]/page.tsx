'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function TicketPage() {
  const router = useRouter();
  const params = useParams();
  const ticketId = params.ticketId as string;

  useEffect(() => {
    // Redirect to tickets page with ticket query parameter
    if (ticketId) {
      router.replace(`/client-portal/tickets?ticket=${ticketId}`);
    }
  }, [ticketId, router]);

  return null;
}
