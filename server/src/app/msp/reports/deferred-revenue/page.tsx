import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { checkFeatureFlag } from '@/lib/feature-flags/serverFeatureFlags';
import DeferredRevenueReport from '@alga-psa/reporting/components/deferred-revenue/DeferredRevenueReport';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.reports.deferredRevenue.title', { defaultValue: 'Deferred revenue' }),
  };
}

/**
 * Deferred-revenue / prepaid liability report. Gated behind the
 * `release-v1-5-feature` feature flag and the `reports.read` permission for
 * internal users; flag off (or no permission) yields a 404 so nothing about
 * the existing UI changes.
 */
export default async function DeferredRevenueReportPage() {
  const currentUser = await getCurrentUser();
  const [flagEnabled, canReadReports] = await Promise.all([
    checkFeatureFlag('release-v1-5-feature'),
    currentUser ? hasPermission(currentUser, 'reports', 'read') : Promise.resolve(false),
  ]);

  if (!flagEnabled || !currentUser || currentUser.user_type !== 'internal' || !canReadReports) {
    notFound();
  }

  return <DeferredRevenueReport />;
}
