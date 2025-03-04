'use client';

import { Suspense } from 'react';
import { TicketList } from 'server/src/components/client-portal/tickets/TicketList';
import { Skeleton } from 'server/src/components/ui/Skeleton';

export default function TicketsPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TicketList />
      </Suspense>
    </div>
  );
}
