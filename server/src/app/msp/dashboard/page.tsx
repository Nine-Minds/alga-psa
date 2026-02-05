import { Suspense } from 'react';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import { DashboardOnboardingSkeleton, DashboardOnboardingSlot } from '@alga-psa/onboarding/components';
import { isEnterprise } from '@/lib/features';

export const dynamic = 'force-dynamic';

function DashboardPage() {
  return (
    <DashboardContainer
      onboardingSection={
        isEnterprise ? (
          <Suspense fallback={<DashboardOnboardingSkeleton />}>
            <DashboardOnboardingSlot />
          </Suspense>
        ) : undefined
      }
    />
  );
}

export default DashboardPage;
