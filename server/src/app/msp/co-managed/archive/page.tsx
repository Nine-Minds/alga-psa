import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedArchive from '@/components/co-managed/CoManagedArchive';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManaged.archive.title', { defaultValue: 'Co-Managed Archive' }) };
}

export const dynamic = 'force-dynamic';

// `serves`: the archive stays readable after the relationship ends and after a licence lapse.
export default async function CoManagedArchivePage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedArchive /></CoManagedFeatureBoundary>;
}
