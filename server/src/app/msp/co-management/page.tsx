import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedPolicyPanel from '@/components/co-managed/CoManagedPolicyPanel';

export default async function CoManagedPolicyPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>;
}
