import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CustomerTicketsUnavailable from '@/components/co-managed/CustomerTicketsUnavailable';
import SharedTicketScreen from '@/components/co-managed/SharedTicketScreen';
import { getSharedTicketDetailsAction } from '@/lib/actions/coManagedSharedWorkActions';
import type { SharedTicketDetailsResult } from '@/lib/co-managed/sharedTicketDataTypes';
import { coManagedTicketReturnHref } from '@/lib/co-managed/ticketListReturn';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.tickets.detail.title', { defaultValue: 'Shared Ticket' }),
  };
}

export default async function CoManagedSharedTicketPage({ params, searchParams }: {
  params: Promise<{ customerTenant: string; relationshipId: string; ticketId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { customerTenant, relationshipId, ticketId } = await params;
  const resource = { tenant: customerTenant, relationshipId, id: ticketId, kind: 'ticket' as const };
  // A ticket that is not shared with this user, was revoked, or is unavailable renders the screen's error state.
  let details: SharedTicketDetailsResult | null = null;
  try { details = await getSharedTicketDetailsAction(resource); } catch { details = null; }
  const backHref = coManagedTicketReturnHref((await searchParams).returnTo);
  return <CoManagedFeatureBoundary mode="serves" fallback={<CustomerTicketsUnavailable />}><SharedTicketScreen resource={resource} initialDetails={details} backHref={backHref} /></CoManagedFeatureBoundary>;
}
