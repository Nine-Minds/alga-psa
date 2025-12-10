'use client';

import { Suspense } from 'react';
import { AppointmentRequestDetailsPage } from 'server/src/components/client-portal/appointments/AppointmentRequestDetailsPage';
import { Skeleton } from 'server/src/components/ui/Skeleton';

export default function AppointmentRequestPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <AppointmentRequestDetailsPage />
      </Suspense>
    </div>
  );
}
