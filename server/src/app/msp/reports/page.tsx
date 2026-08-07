import Reports from '@alga-psa/msp-composition/reports/Reports';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getSession } from '@alga-psa/auth';
import { resolveTier } from '@alga-psa/types';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.reports.title', { defaultValue: 'Reports' }),
  };
}

export default async function ReportsPage() {
  const [session, productCode] = await Promise.all([
    getSession(),
    getCurrentTenantProduct(),
  ]);
  const { tier } = resolveTier(session?.user?.effectiveTier ?? session?.user?.plan);

  return <Reports productCode={productCode} tier={tier} />;
}
