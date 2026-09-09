import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedTicketPanel from '@/components/co-managed/CoManagedTicketPanel';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.tickets.detail.title', { defaultValue: 'Shared Ticket' }),
  };
}

export default async function CoManagedSharedTicketPage({ params }: {
  params: Promise<{ customerTenant: string; relationshipId: string; ticketId: string }>;
}) {
  const { customerTenant, relationshipId, ticketId } = await params;
  return <CoManagedFeatureBoundary><div className="mx-auto max-w-5xl p-6"><CoManagedTicketPanel showSummary
    target={{ kind: 'shared', resource: { tenant: customerTenant, relationshipId, id: ticketId, kind: 'ticket' } }} />
  </div></CoManagedFeatureBoundary>;
}
