import Reports from '@alga-psa/ui/pages/Reports';
import type { Metadata } from 'next';
import { getSession } from '@alga-psa/auth';
import { resolveProductCode, resolveTier } from '@alga-psa/types';

export const metadata: Metadata = {
  title: 'Reports',
};

export default async function ReportsPage() {
  const session = await getSession();
  const { productCode } = resolveProductCode(session?.user?.product_code);
  const { tier } = resolveTier(session?.user?.plan);

  return <Reports productCode={productCode} tier={tier} />;
}
