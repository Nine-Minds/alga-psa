import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProjectTaskEditor from '@/components/co-managed/CoManagedProjectTaskEditor';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.tasks.detail.title', { defaultValue: 'Shared Project Task' }),
  };
}
export default async function SharedTaskPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; taskId: string }> }) {
  const { customerTenant, relationshipId, taskId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-3xl p-6"><CoManagedProjectTaskEditor resource={{ tenant: customerTenant, relationshipId, kind: 'project_task', id: taskId }} /></div></CoManagedFeatureBoundary>;
}
