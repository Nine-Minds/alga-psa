import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedProjectTaskEditor from '@/components/co-managed/CoManagedProjectTaskEditor';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTasks.taskTitle', { defaultValue: 'Shared Task' }) };
}

export default async function CoManagedSharedTaskPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; taskId: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  const userId = session?.user?.id;
  if (!tenant || !userId) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { customerTenant, relationshipId, taskId } = await params;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedProjectTaskEditor customerTenant={customerTenant} relationshipId={relationshipId} taskId={taskId} userId={userId} />
  </CoManagedFeatureBoundary>;
}
