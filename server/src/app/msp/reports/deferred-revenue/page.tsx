import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import DeferredRevenueReport from '@alga-psa/reporting/components/deferred-revenue/DeferredRevenueReport';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.reports.deferredRevenue.title', { defaultValue: 'Deferred revenue' }),
  };
}

/**
 * Deferred-revenue / prepaid liability report. Gated behind the
 * `reports.read` permission for internal users; no permission yields a 404.
 */
export default async function DeferredRevenueReportPage() {
  const currentUser = await getCurrentUser();
  const canReadReports = currentUser ? await hasPermission(currentUser, 'reports', 'read') : false;

  if (!currentUser || currentUser.user_type !== 'internal' || !canReadReports) {
    notFound();
  }

  return <DeferredRevenueReport />;
}
