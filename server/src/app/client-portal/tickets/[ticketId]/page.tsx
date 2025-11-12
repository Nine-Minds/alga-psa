'use client';

import { Suspense } from 'react';
import { TicketDetailsPage } from 'server/src/components/client-portal/tickets/TicketDetailsPage';
import { Skeleton } from 'server/src/components/ui/Skeleton';

export default function TicketPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TicketDetailsPage />
      </Suspense>
    </div>
  );
}
