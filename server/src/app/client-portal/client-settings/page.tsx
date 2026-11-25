import { ClientPortalSettingsPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checkClientPortalPermissions } from '@alga-psa/client-portal/actions';
import { resolveClientPortalSettingsSurfaces } from '@alga-psa/client-portal/lib/clientPortalSettingsSurfaces';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.clientSettings.title', { defaultValue: 'Company Settings' }),
    description: t('clientPortal.clientSettings.description', { defaultValue: 'Manage your company settings and configurations' }),
  };
}

export default async function ClientSettingsPage() {
  // Same resolver as the sidebar link and the tab list: no permitted tab means no page.
  const permissions = await checkClientPortalPermissions();
  if (!resolveClientPortalSettingsSurfaces(permissions).canOpenSettings) {
    notFound();
  }
  return <ClientPortalSettingsPage />;
}
