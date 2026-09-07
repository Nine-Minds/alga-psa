import { getConnection, tenantDb } from '@alga-psa/db';
import { TenantEmailService } from '@alga-psa/email';
import { buildTenantPortalSlug } from '@alga-psa/shared/utils/tenantSlug';
import type { CoManagedRequesterEmailDelivery } from '@alga-psa/co-managed';

// LEVERAGE: pattern ticket-email-routing — native ticket mail resolves the same sender settings and active portal domain in its subscriber.
export async function resolveCoManagedRequesterEmailRouting(delivery: CoManagedRequesterEmailDelivery) {
  const db = await getConnection(delivery.tenant), owner = tenantDb(db, delivery.tenant);
  const settings = await TenantEmailService.getTenantEmailSettings(delivery.tenant, db);
  const configuredEmail = settings?.ticketingFromEmail?.trim() ?? '', configuredName = settings?.ticketingFromName?.trim() ?? '';
  let from: { email: string; name?: string } | undefined;
  if (configuredEmail || configuredName) {
    const email = configuredEmail || TenantEmailService.getDefaultFromAddress(settings).email;
    if (email) {
      const provider = configuredEmail ? await owner.table('email_providers').where('mailbox', configuredEmail).first('sender_display_name') : null;
      from = { email, name: configuredName || provider?.sender_display_name?.trim() || undefined };
    }
  }
  const source = await owner.table('tickets').where('ticket_id', delivery.message.resource.id).first('board_id', 'email_metadata');
  if (from && !from.name && source?.board_id) from.name = (await owner.table('boards').where('board_id', source.board_id).first('board_name'))?.board_name || undefined;
  // Preserve the originating intake mailbox when available. Explicit ticketing
  // sender settings otherwise retain their existing tenant-configured behavior.
  const providerId = source?.email_metadata?.providerId ?? source?.email_metadata?.provider_id;
  const origin = providerId ? await owner.table('email_providers').where({ id: providerId, is_active: true }).first('mailbox', 'sender_display_name') : null;
  const replyTo = origin?.mailbox ? { email: origin.mailbox, name: origin.sender_display_name || undefined } : from;
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid email application URL');
  const domain = await owner.table('portal_domains').first('domain', 'status');
  const url = new URL(`/client-portal/tickets/${delivery.message.resource.id}`, base.origin);
  if (domain?.status === 'active' && domain.domain) {
    const host = domain.domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!/^[a-z0-9.-]+$/i.test(host) || host.includes('..')) throw new Error('Invalid active portal domain');
    url.protocol = 'https:'; url.host = host;
  } else url.searchParams.set('tenant', buildTenantPortalSlug(delivery.tenant));
  return { url: url.toString(), from, replyTo };
}
