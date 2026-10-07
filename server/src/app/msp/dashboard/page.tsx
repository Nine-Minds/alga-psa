import { Suspense } from 'react';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import AlgaDeskDashboard from '@/components/dashboard/AlgaDeskDashboard';
import { getDashboardMobileAppCardDismissedAction } from '@/lib/actions/dashboardMobileAppActions';
import { getAlgaDeskDashboardSummary } from '@/lib/actions/algadeskDashboardActions';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { getDashboardWelcomeSettingsAction } from '@alga-psa/tenancy/actions/tenant-settings-actions/dashboardWelcomeActions';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import { DashboardOnboardingSkeleton, DashboardOnboardingSlot } from '@alga-psa/onboarding/components';
import { isEnterprise } from '@/lib/features';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.dashboard.title', { defaultValue: 'Dashboard' }),
  };
}

export const dynamic = 'force-dynamic';

async function DashboardPage() {
  const productCode = await getCurrentTenantProduct();

  if (productCode === 'algadesk') {
    const summary = await getAlgaDeskDashboardSummary();
    return <AlgaDeskDashboard summary={summary} />;
  }

  const mobileAppCardDismissed = await getDashboardMobileAppCardDismissedAction().catch(() => false);
  const selfHost = await isSelfHostLicensing().catch(() => false);
  // Opt-in, and only when there is a company to name — the banner must never
  // fail the page, so a lookup problem falls back to the stock title.
  const welcome = await getDashboardWelcomeSettingsAction().catch(() => null);
  const welcomeCompanyName = welcome?.useCompanyName ? welcome.companyName : null;

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
      selfHost={selfHost}
      welcomeCompanyName={welcomeCompanyName}
    />
  );
}

export default DashboardPage;
