import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProjectTasks from '@/components/co-managed/CoManagedProjectTasks';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.projects.detail.title', { defaultValue: 'Shared Project' }),
  };
}
export default async function SharedProjectPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; projectId: string }> }) {
  const { customerTenant, relationshipId, projectId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-5xl p-6"><CoManagedProjectTasks resource={{ tenant: customerTenant, relationshipId, kind: 'project', id: projectId }} /></div></CoManagedFeatureBoundary>;
}
