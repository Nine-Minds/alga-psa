'use client';

import { Suspense } from 'react';
import { AppointmentRequestDetailsPage } from '@alga-psa/client-portal/components';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

export default function AppointmentRequestPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <AppointmentRequestDetailsPage />
      </Suspense>
    </div>
  );
}
