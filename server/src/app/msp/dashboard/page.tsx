import { Suspense } from 'react';
import DashboardContainer from '@alga-psa/ui/components/dashboard/DashboardContainer';
import { DashboardOnboardingSkeleton } from '@alga-psa/ui/components/dashboard/DashboardOnboardingSkeleton';
import { DashboardOnboardingSlot } from '@alga-psa/ui/components/dashboard/DashboardOnboardingSlot';

export const dynamic = 'force-dynamic';

function DashboardPage() {
  return (
    <DashboardContainer
      onboardingSection={(
        <Suspense fallback={<DashboardOnboardingSkeleton />}>
          <DashboardOnboardingSlot />
        </Suspense>
      )}
    />
  );
}

export default DashboardPage;
