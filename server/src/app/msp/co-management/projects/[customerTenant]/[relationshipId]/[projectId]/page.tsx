import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedProjectTasks from '@/components/co-managed/CoManagedProjectTasks';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTasks.projectTitle', { defaultValue: 'Shared Project' }) };
}

export default async function CoManagedSharedProjectPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; projectId: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { customerTenant, relationshipId, projectId } = await params;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedProjectTasks customerTenant={customerTenant} relationshipId={relationshipId} projectId={projectId} />
  </CoManagedFeatureBoundary>;
}
