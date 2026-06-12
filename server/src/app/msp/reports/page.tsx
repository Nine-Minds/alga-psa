import Reports from '@alga-psa/msp-composition/reports/Reports';
import type { Metadata } from 'next';
import { getSession } from '@alga-psa/auth';
import { resolveTier } from '@alga-psa/types';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export const metadata: Metadata = {
  title: 'Reports',
};

export default async function ReportsPage() {
  const [session, productCode] = await Promise.all([
    getSession(),
    getCurrentTenantProduct(),
  ]);
  const { tier } = resolveTier(session?.user?.effectiveTier ?? session?.user?.plan);

  return <Reports productCode={productCode} tier={tier} />;
}
