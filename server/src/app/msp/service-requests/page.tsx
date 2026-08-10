import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import ServiceRequestsManagementPage from './ServiceRequestsManagementPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.serviceRequests.title', { defaultValue: 'Service Requests' }),
  };
}

export default function MspServiceRequestsPage() {
  return <ServiceRequestsManagementPage />;
}
