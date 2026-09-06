import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedTicketPanel from '@/components/co-managed/CoManagedTicketPanel';

export default async function CoManagedSharedTicketPage({ params }: {
  params: Promise<{ customerTenant: string; relationshipId: string; ticketId: string }>;
}) {
  const { customerTenant, relationshipId, ticketId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-5xl p-6"><CoManagedTicketPanel showSummary
    target={{ kind: 'shared', resource: { tenant: customerTenant, relationshipId, id: ticketId, kind: 'ticket' } }} />
  </div></CoManagedFeatureBoundary>;
}
