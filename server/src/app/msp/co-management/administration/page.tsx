import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedDelegatedAdministration from '@/components/co-managed/CoManagedDelegatedAdministration';
export default async function DelegatedAdministrationPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedDelegatedAdministration operationId={operationId} /></CoManagedFeatureBoundary>;
}
