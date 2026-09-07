import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedProjectTasks from '@/components/co-managed/CoManagedProjectTasks';
export default async function SharedProjectPage({ params }: { params: Promise<{ customerTenant: string; relationshipId: string; projectId: string }> }) {
  const { customerTenant, relationshipId, projectId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-5xl p-6"><CoManagedProjectTasks resource={{ tenant: customerTenant, relationshipId, kind: 'project', id: projectId }} /></div></CoManagedFeatureBoundary>;
}
