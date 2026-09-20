import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProviderSetup from '@/components/co-managed/CoManagedProviderSetup';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.providers.title', { defaultValue: 'Email and Identity Providers' }),
  };
}

export default function CoManagedProvidersPage() {
  return <CoManagedFeatureBoundary><CoManagedProviderSetup /></CoManagedFeatureBoundary>;
}
