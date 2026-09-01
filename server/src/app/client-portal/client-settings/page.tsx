import { ClientPortalSettingsPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.clientSettings.title', { defaultValue: 'Company Settings' }),
    description: t('clientPortal.clientSettings.description', { defaultValue: 'Manage your company settings and configurations' }),
  };
}

export default function ClientSettingsPage() {
  return <ClientPortalSettingsPage />;
}
