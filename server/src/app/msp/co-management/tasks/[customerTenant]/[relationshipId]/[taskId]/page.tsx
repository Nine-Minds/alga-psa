import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProjectTaskEditor from '@/components/co-managed/CoManagedProjectTaskEditor';
export default async function SharedTaskPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; taskId: string }> }) {
  const { customerTenant, relationshipId, taskId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-3xl p-6"><CoManagedProjectTaskEditor resource={{ tenant: customerTenant, relationshipId, kind: 'project_task', id: taskId }} /></div></CoManagedFeatureBoundary>;
}
