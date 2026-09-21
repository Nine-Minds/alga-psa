import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedDeparture from '@/components/co-managed/CoManagedDeparture';
import CoManagedLegacyRedirect from '@/components/co-managed/CoManagedLegacyRedirect';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.departure.title', { defaultValue: 'End Co-Management' }),
  };
}

export default async function CoManagedDeparturePage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedLegacyRedirect operationId={operationId} section="history"><CoManagedDeparture operationId={operationId} /></CoManagedLegacyRedirect></CoManagedFeatureBoundary>;
}
