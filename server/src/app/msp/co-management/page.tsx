import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import { CoManagedUpgradeEntry } from '@/components/co-managed/CoManagedUpgrade';
import { CoManagedDepartureEntry } from '@/components/co-managed/CoManagedDeparture';
import CoManagedPolicyPanel from '@/components/co-managed/CoManagedPolicyPanel';
import { CoManagedPortableExportEntry } from '@/components/co-managed/CoManagedPortableExport';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.title', { defaultValue: 'Co-Managed Access' }),
  };
}

export default async function CoManagedPolicyPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedUpgradeEntry /><CoManagedPortableExportEntry /><CoManagedDepartureEntry operationId={operationId} /><CoManagedPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>;
}
