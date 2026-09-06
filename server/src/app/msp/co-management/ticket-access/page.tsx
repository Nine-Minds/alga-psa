import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedExplicitTicketGrantsPanel from '@/components/co-managed/CoManagedExplicitTicketGrantsPanel';

export default function CoManagedTicketAccessPage() {
  return <CoManagedFeatureBoundary><CoManagedExplicitTicketGrantsPanel /></CoManagedFeatureBoundary>;
}
