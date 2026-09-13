import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedDelegatedAdministration from '@/components/co-managed/CoManagedDelegatedAdministration';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.administration.title', { defaultValue: 'Delegated Administration' }),
  };
}
export default async function DelegatedAdministrationPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedDelegatedAdministration operationId={operationId} /></CoManagedFeatureBoundary>;
}
