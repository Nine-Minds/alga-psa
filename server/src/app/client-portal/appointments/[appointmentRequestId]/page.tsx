import { Suspense } from 'react';
import { AppointmentRequestDetailsPage } from '@alga-psa/client-portal/components';
import { getClientPortalFeatureSettings } from '@alga-psa/client-portal/actions/client-portal-actions/clientPortalFeatureSettingsActions';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { redirect } from 'next/navigation';

export default async function AppointmentRequestPage() {
  const portalFeatureSettings = await getClientPortalFeatureSettings();
  if (!portalFeatureSettings.appointmentsEnabled) {
    redirect('/client-portal/dashboard');
  }

  return (
    <div className="w-full">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <AppointmentRequestDetailsPage />
      </Suspense>
    </div>
  );
}
