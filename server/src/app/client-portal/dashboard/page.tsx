import { ClientDashboard } from '@alga-psa/client-portal/components';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const productCode = await getCurrentTenantProduct();
  return <ClientDashboard productCode={productCode} />;
}
