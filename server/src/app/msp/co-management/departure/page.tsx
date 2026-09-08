import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedDeparture from '@/components/co-managed/CoManagedDeparture';

export default async function CoManagedDeparturePage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedDeparture operationId={operationId} /></CoManagedFeatureBoundary>;
}
