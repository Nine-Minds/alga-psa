import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { ClientDevicesPage } from '@alga-psa/client-portal/components';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.devices.title', { defaultValue: 'My devices' }),
  };
}

export default function DevicesPage() {
  return <ClientDevicesPage />;
}
