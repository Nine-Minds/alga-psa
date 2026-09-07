import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedTicketQueue from '@/components/co-managed/CoManagedTicketQueue';
export default function CoManagedTicketQueuesPage() {
  return <CoManagedFeatureBoundary><CoManagedTicketQueue /></CoManagedFeatureBoundary>;
}
