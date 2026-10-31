import logger from '@alga-psa/core/logger';
import { CO_MANAGED_LEDGER, finishDelivery, claimDelivery } from '@shared/lib/deliveryLedger';
import type { CoManagedDeliveryProvider, RoutingDelivery } from '@shared/lib/coManagedDelivery';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import { getConnection } from '../db/db';
import { sendEventEmail } from './sendEventEmail';

const IN_APP_TEMPLATE: Record<RoutingDelivery['event'], string> = {
  escalation_received: 'co-managed-escalation-received',
  escalation_returned: 'co-managed-escalation-returned',
  ticket_assigned: 'co-managed-ticket-assigned',
};
const HEADLINE: Record<RoutingDelivery['event'], (d: RoutingDelivery) => string> = {
  escalation_received: (d) => `${d.actorName} escalated ticket #${d.ticketNumber}`,
  escalation_returned: (d) => `Ticket #${d.ticketNumber} was handed back`,
  ticket_assigned: (d) => `Shared ticket #${d.ticketNumber} was assigned to you`,
};

const baseUrl = () => (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
// Keyed on the stored row (`ledgerRecipient`), not the current send address, so claim/finish match the pending row.
const ledgerKey = (d: RoutingDelivery) => ({ delivery_kind: d.deliveryKind, source_id: d.sourceId, recipient: (d.ledgerRecipient ?? d.recipient.email ?? d.recipient.principalId) });

/**
 * Deliver ONE owed routing row. Safe to call any number of times, concurrently or after a crash:
 * the in-app path claims + creates + marks sent in one transaction; the email path claims before the
 * provider call and finishes after it (an unknown provider outcome stays `sending` with
 * `requires_reconciliation` and is never re-sent).
 */
export async function deliverRoutingRow(d: RoutingDelivery): Promise<'sent' | 'skipped' | 'failed'> {
  const key = ledgerKey(d);
  if (!d.allowed) {
    // The recipient's current policy no longer admits them: a completed (skipped) delivery, not a retry.
    if (await claimDelivery(await getConnection(d.tenant), CO_MANAGED_LEDGER, d.tenant, key)) {
      await finishDelivery(await getConnection(d.tenant), CO_MANAGED_LEDGER, d.tenant, key, 'sent', { errorCode: 'recipient_not_permitted' });
    }
    return 'skipped';
  }
  const data = { actorName: d.actorName, actorOrganization: d.actorOrganization, ticketNumber: d.ticketNumber, ticketTitle: d.ticketTitle };
  const sponsorSide = d.recipient.kind === 'msp_user' || d.recipient.kind === 'team';
  const link = sponsorSide ? '/msp/co-managed' : `/msp/tickets/${d.ticketId}`;
  try {
    if (d.deliveryKind === 'routing_in_app') {
      await createNotificationFromTemplateInternal(await getConnection(d.recipientTenant), {
        tenant: d.recipientTenant, user_id: d.recipient.principalId, template_name: IN_APP_TEMPLATE[d.event],
        type: 'info', category: 'co-managed', link, data,
      }, { delivery: { ledger: CO_MANAGED_LEDGER, key, extra: { recipient_kind: d.recipient.kind }, ledgerTenant: d.tenant } });
      return 'sent';
    }
    await sendEventEmail({
      mailClass: 'ticket', tenantId: d.recipientTenant, to: d.recipient.email!, recipientUserId: d.recipient.principalId,
      subject: HEADLINE[d.event](d), template: 'co-managed-routing', entityType: 'ticket', entityId: d.ticketId,
      context: { routing: { headline: HEADLINE[d.event](d), body: `${d.actorName} (${d.actorOrganization}): ${d.ticketTitle}` },
        ticket: { url: `${baseUrl()}${link}`, id: d.ticketNumber } },
      delivery: { ledger: CO_MANAGED_LEDGER, key, extra: { recipient_kind: d.recipient.kind }, ledgerTenant: d.tenant },
    });
    return 'sent';
  } catch (error) {
    // The ledger row is already `failed` (retryable) or `sending`+requires_reconciliation (unknown outcome).
    logger.warn('[CoManagedRouting] delivery failed; recovery will retry failed rows only', {
      tenant: d.tenant, kind: d.deliveryKind, sourceId: d.sourceId, error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}

export async function deliverRouting(provider: CoManagedDeliveryProvider, tenant: string, opts: { sourceId?: string; limit?: number } = {}) {
  const tally = { sent: 0, skipped: 0, failed: 0 };
  for (const row of await provider.pendingRouting(tenant, opts)) tally[await deliverRoutingRow(row)] += 1;
  return tally;
}
