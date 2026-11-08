import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCoManagedSharedTicketAction } from '@/lib/actions/coManagedWorkActions';
import { coManagedSharedTicketHref } from '@/lib/co-managed/ticketListReturn';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sharedTicket.title', { defaultValue: 'Shared Ticket' }) };
}

/**
 * Old standalone shared-ticket URL (it carries no customer tenant). The tenant is resolved through the same
 * admitted read the old page used, then the caller is sent to the native screen. A denial in any access layer
 * (or an unknown id) is the same plain 404 as before.
 */
export default async function CoManagedSharedTicketRedirect({ params, searchParams }: {
  params: Promise<{ relationshipId: string; ticketId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const { relationshipId, ticketId } = await params;
  const summary = await getCoManagedSharedTicketAction(relationshipId, ticketId);
  if (!summary) notFound();
  redirect(coManagedSharedTicketHref(summary.resource, (await searchParams).returnTo));
}
