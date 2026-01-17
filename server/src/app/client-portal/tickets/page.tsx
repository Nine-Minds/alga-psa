'use client';

import { Suspense } from 'react';
import { TicketList } from '@alga-psa/client-portal/components';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

export default function TicketsPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TicketList />
      </Suspense>
    </div>
  );
}
