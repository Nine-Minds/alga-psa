import { Suspense } from 'react';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import { DashboardOnboardingSkeleton, DashboardOnboardingSlot } from '@alga-psa/onboarding/components';

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
