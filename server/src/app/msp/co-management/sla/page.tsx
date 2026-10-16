import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedSlaPolicyPanel from '@/components/co-managed/CoManagedSlaPolicyPanel';
import CoManagedLegacyRedirect from '@/components/co-managed/CoManagedLegacyRedirect';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.sla.title', { defaultValue: 'Co-Managed SLA Priorities' }),
  };
}

export default async function CoManagedSlaPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedLegacyRedirect operationId={operationId} section="sla"><CoManagedSlaPolicyPanel operationId={operationId} /></CoManagedLegacyRedirect></CoManagedFeatureBoundary>;
}
