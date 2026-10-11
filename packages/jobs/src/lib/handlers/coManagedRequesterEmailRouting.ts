import { getConnection, tenantDb } from '@alga-psa/db';
import { buildTenantPortalSlug } from '@alga-psa/shared/utils/tenantSlug';
import type { CoManagedRequesterEmailDelivery } from '@alga-psa/co-managed';

// LEVERAGE: pattern ticket-email-routing — native ticket mail resolves the same sender settings and active portal domain in its subscriber.
export async function resolveCoManagedRequesterEmailRouting(delivery: CoManagedRequesterEmailDelivery) {
  const { boardId, replyTo } = await resolveCoManagedTicketEmailMailbox(delivery.tenant, delivery.message.resource.id);
  const db = await getConnection(delivery.tenant), owner = tenantDb(db, delivery.tenant);
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid email application URL');
  const domain = await owner.table('portal_domains').first('domain', 'status');
  const url = new URL(`/client-portal/tickets/${delivery.message.resource.id}`, base.origin);
  if (domain?.status === 'active' && domain.domain) {
    const host = domain.domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!/^[a-z0-9.-]+$/i.test(host) || host.includes('..')) throw new Error('Invalid active portal domain');
    url.protocol = 'https:'; url.host = host;
  } else url.searchParams.set('tenant', buildTenantPortalSlug(delivery.tenant));
  return { url: url.toString(), boardId, replyTo };
}

/** The sender is the ticket board's outbound route (TenantEmailService resolves
 * it from `boardId`, as for native ticket mail). Replies return to the
 * originating intake mailbox when the ticket arrived by email. */
export async function resolveCoManagedTicketEmailMailbox(tenant: string, ticketId: string) {
  const db = await getConnection(tenant), owner = tenantDb(db, tenant);
  const source = await owner.table('tickets').where('ticket_id', ticketId).first('board_id', 'email_metadata');
  const providerId = source?.email_metadata?.providerId ?? source?.email_metadata?.provider_id;
  const origin = providerId ? await owner.table('email_providers').where({ id: providerId, is_active: true }).first('mailbox', 'sender_display_name') : null;
  return {
    boardId: (source?.board_id as string | undefined) ?? undefined,
    replyTo: origin?.mailbox ? { email: origin.mailbox as string, name: (origin.sender_display_name as string | null) || undefined } : undefined,
  };
}
