import { Suspense } from 'react';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import AlgadeskDashboard from '@/components/dashboard/AlgadeskDashboard';
import { getDashboardMobileAppCardDismissedAction } from '@/lib/actions/dashboardMobileAppActions';
import { getAlgadeskDashboardSummary } from '@/lib/actions/algadeskDashboardActions';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { DashboardOnboardingSkeleton, DashboardOnboardingSlot } from '@alga-psa/onboarding/components';
import { getSession } from '@alga-psa/auth';
import { isEnterprise } from '@/lib/features';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

async function DashboardPage() {
  const productCode = await getCurrentTenantProduct();

  if (productCode === 'algadesk') {
    const summary = await getAlgadeskDashboardSummary();
    return <AlgadeskDashboard summary={summary} />;
  }

  const [session, mobileAppCardDismissed] = await Promise.all([
    getSession(),
    getDashboardMobileAppCardDismissedAction().catch(() => false),
  ]);
  // Use session's eeEnabled (set by auth options); fall back to build-time isEnterprise for
  // SaaS sessions that pre-date this field (no self-host licensing).
  const eeEnabled = session?.user?.eeEnabled ?? isEnterprise;

  return (
    <DashboardContainer
      onboardingSection={
        eeEnabled ? (
          <Suspense fallback={<DashboardOnboardingSkeleton />}>
            <DashboardOnboardingSlot />
          </Suspense>
        ) : undefined
      }
      initialMobileAppCardDismissed={!!mobileAppCardDismissed}
    />
  );
}

export default DashboardPage;
