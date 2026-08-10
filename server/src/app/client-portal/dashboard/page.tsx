import { ClientDashboard } from '@alga-psa/client-portal/components';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getClientPortalFeatureSettings } from '@alga-psa/client-portal/actions/client-portal-actions/clientPortalFeatureSettingsActions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.dashboard.title', { defaultValue: 'Dashboard' }),
  };
}

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
