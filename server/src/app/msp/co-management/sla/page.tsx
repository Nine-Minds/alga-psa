import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedSlaPolicyPanel from '@/components/co-managed/CoManagedSlaPolicyPanel';

export default async function CoManagedSlaPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedSlaPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>;
}
