import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManaged.title', { defaultValue: 'Co-Managed IT' }),
  };
}

export default async function CoManagedPage({ searchParams }: { searchParams?: Promise<{ clientId?: string }> }) {
  const clientId = (await searchParams)?.clientId;
  const initialClientId = typeof clientId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) ? clientId : undefined;
  return <CoManagedFeatureBoundary><CoManagedOverview initialClientId={initialClientId} /></CoManagedFeatureBoundary>;
}
