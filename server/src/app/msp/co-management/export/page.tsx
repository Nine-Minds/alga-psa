import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { ampWorkspaceExportAvailability } from '@ee/lib/co-managed/ampExportHandler';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedAmpExport from '@/components/co-managed/CoManagedAmpExport';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.export.title', { defaultValue: 'Export Workspace' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedAmpExportPage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedAmpExport available={ampWorkspaceExportAvailability.available} />
  </CoManagedFeatureBoundary>;
}
