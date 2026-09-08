import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedUpgrade from '@/components/co-managed/CoManagedUpgrade';

export default function CoManagedUpgradePage() {
  return <CoManagedFeatureBoundary><CoManagedUpgrade /></CoManagedFeatureBoundary>;
}
