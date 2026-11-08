import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedSharedProject from '@/components/co-managed/CoManagedSharedProject';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export const dynamic = 'force-dynamic';

// Static title only: never call the native getProject with a customer id from RSC metadata.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTasks.projectTitle', { defaultValue: 'Shared Project' }) };
}

export default async function CoManagedSharedProjectPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; projectId: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  const userId = session?.user?.id;
  if (!tenant || !userId) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { customerTenant, relationshipId, projectId } = await params;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedSharedProject customerTenant={customerTenant} relationshipId={relationshipId} projectId={projectId} userId={userId} />
  </CoManagedFeatureBoundary>;
}
