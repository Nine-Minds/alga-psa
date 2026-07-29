import { ClientDashboard } from '@alga-psa/client-portal/components';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';
import { getClientPortalFeatureSettings } from '@alga-psa/client-portal/actions/client-portal-actions/clientPortalFeatureSettingsActions';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const [productCode, portalFeatureSettings] = await Promise.all([
    getCurrentTenantProduct(),
    getClientPortalFeatureSettings(),
  ]);
  return (
    <ClientDashboard
      productCode={productCode}
      appointmentsEnabled={portalFeatureSettings.appointmentsEnabled}
    />
  );
}
