import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { DEFAULT_CUSTOMER_TICKETS_HREF } from '@/lib/co-managed/ticketListReturn';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.customerTickets.title', { defaultValue: 'Customer Tickets' }) };
}

/**
 * The Customer Tickets queue lives at /msp/tickets/customer. This dark route only forwards there; the
 * destination page holds the capability gate, so nothing is revealed or bypassed here.
 */
export default async function CoManagedCustomerTicketsRedirect(): Promise<never> {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  redirect(DEFAULT_CUSTOMER_TICKETS_HREF);
}
