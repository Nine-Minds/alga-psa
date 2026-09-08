import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import { CoManagedUpgradeEntry } from '@/components/co-managed/CoManagedUpgrade';
import { CoManagedDepartureEntry } from '@/components/co-managed/CoManagedDeparture';
import CoManagedPolicyPanel from '@/components/co-managed/CoManagedPolicyPanel';

export default async function CoManagedPolicyPage({ searchParams }: { searchParams?: Promise<{ operationId?: string }> }) {
  const operationId = (await searchParams)?.operationId;
  return <CoManagedFeatureBoundary><CoManagedUpgradeEntry /><CoManagedDepartureEntry operationId={operationId} /><CoManagedPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>;
}
