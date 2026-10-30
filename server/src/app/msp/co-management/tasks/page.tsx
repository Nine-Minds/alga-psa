import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedProjectTaskQueue from '@/components/co-managed/CoManagedProjectTaskQueue';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTasks.title', { defaultValue: 'Shared Tasks' }) };
}

export default async function CoManagedSharedTasksPage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedProjectTaskQueue /></CoManagedFeatureBoundary>;
}
