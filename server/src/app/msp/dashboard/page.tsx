import { Suspense } from 'react';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import AlgaDeskDashboard from '@/components/dashboard/AlgaDeskDashboard';
import { getDashboardMobileAppCardDismissedAction } from '@/lib/actions/dashboardMobileAppActions';
import { getAlgaDeskDashboardSummary } from '@/lib/actions/algadeskDashboardActions';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { DashboardOnboardingSkeleton, DashboardOnboardingSlot } from '@alga-psa/onboarding/components';
import { isEnterprise } from '@/lib/features';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

async function DashboardPage() {
  const productCode = await getCurrentTenantProduct();

  if (productCode === 'algadesk') {
    const summary = await getAlgaDeskDashboardSummary();
    return <AlgaDeskDashboard summary={summary} />;
  }

  const mobileAppCardDismissed = await getDashboardMobileAppCardDismissedAction().catch(() => false);

  return (
    <DashboardContainer
      onboardingSection={
        isEnterprise ? (
          <Suspense fallback={<DashboardOnboardingSkeleton />}>
            <DashboardOnboardingSlot />
          </Suspense>
        ) : undefined
      }
      initialMobileAppCardDismissed={mobileAppCardDismissed}
    />
  );
}

export default DashboardPage;
