import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import SharedTicketScreen from '@/components/co-managed/SharedTicketScreen';
import { getSharedTicketDetailsAction } from '@/lib/actions/coManagedSharedWorkActions';
import type { SharedTicketDetailsResult } from '@/lib/co-managed/sharedTicketDataTypes';

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
  const resource = { tenant: customerTenant, relationshipId, id: ticketId, kind: 'ticket' as const };
  // A ticket that is not shared with this user, was revoked, or is unavailable renders the screen's error state.
  let details: SharedTicketDetailsResult | null = null;
  try { details = await getSharedTicketDetailsAction(resource); } catch { details = null; }
  return <CoManagedFeatureBoundary><SharedTicketScreen resource={resource} initialDetails={details} /></CoManagedFeatureBoundary>;
}
