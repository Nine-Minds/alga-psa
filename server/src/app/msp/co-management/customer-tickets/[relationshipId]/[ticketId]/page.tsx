import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCoManagedSharedTicketAction } from '@/lib/actions/coManagedWorkActions';
import CoManagedSharedTicket from '@/components/co-managed/CoManagedSharedTicket';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTicket.title', { defaultValue: 'Shared Ticket' }) };
}

export const dynamic = 'force-dynamic';

/** A ticket the customer shared with this MSP, read-only. A denial in any access layer is a plain 404. */
export default async function CoManagedSharedTicketPage({ params }: { params: Promise<{ relationshipId: string; ticketId: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { relationshipId, ticketId } = await params;
  const summary = await getCoManagedSharedTicketAction(relationshipId, ticketId);
  if (!summary) notFound();
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedSharedTicket summary={summary} backHref="/msp/co-management/customer-tickets" />
  </CoManagedFeatureBoundary>;
}
