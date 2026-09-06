import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';

export default function CoManagedPage() {
  return <CoManagedFeatureBoundary><CoManagedOverview /></CoManagedFeatureBoundary>;
}
