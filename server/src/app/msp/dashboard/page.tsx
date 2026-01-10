import { Suspense } from 'react';
import DashboardContainer from '../../../components/dashboard/DashboardContainer';
import { DashboardOnboardingSkeleton } from '../../../components/dashboard/DashboardOnboardingSkeleton';
import { DashboardOnboardingSlot } from '../../../components/dashboard/DashboardOnboardingSlot';

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
