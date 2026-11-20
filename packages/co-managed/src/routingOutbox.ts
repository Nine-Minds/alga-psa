import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { DeliveryRecipient } from '@alga-psa/shared/lib/coManagedDelivery';
import { sponsorParticipants } from './deliveryProvider';

export type CoManagedRoutingEvent = 'escalation_received' | 'escalation_returned' | 'ticket_assigned';

/** Self-contained delivery context stored on each ledger row, so recovery never re-derives who acted. */
export interface CoManagedRoutingPayload {
  event: CoManagedRoutingEvent;
  ticketId: string;
  relationshipId: string;
  sponsorTenant: string;
  actorName: string;
  actorOrganization: string;
}

export const ROUTING_IN_APP_KIND = 'routing_in_app';
export const ROUTING_EMAIL_KIND = 'routing_email';

/**
 * Transactional outbox for routing notifications. Called inside the transition's own transaction,
 * right after its receipt row: the recipient set is captured atomically with the transition as
 * `pending` ledger rows (one in-app + one email per recipient), keyed by the command's operation id.
 * The post-commit subscriber and the recovery job both deliver by claiming those rows, so a lost
 * event, a crash or the kill switch only delays delivery; it never duplicates or drops it.
 * Whether a recipient may still see the ticket is re-checked at delivery time, not here.
 */
export async function enqueueCoManagedRouting(trx: Knex.Transaction, input: {
  customerTenant: string; sponsorTenant: string; relationshipId: string; ticketId: string; operationId: string;
  event: CoManagedRoutingEvent; actorName: string; actorOrganization: string;
}): Promise<number> {
  const shared = { relationshipId: input.relationshipId, relationship: { sponsor_tenant: input.sponsorTenant } };
  let recipients: DeliveryRecipient[];
  if (input.event === 'escalation_returned') {
    // The ticket is the customer's again: tell whoever owns it in the customer tenant.
    const ticket = await tenantDb(trx, input.customerTenant).table('tickets').where({ ticket_id: input.ticketId }).first('assigned_to');
    const user = ticket?.assigned_to
      ? await tenantDb(trx, input.customerTenant).table('users').where({ user_id: ticket.assigned_to, is_inactive: false }).first('user_id', 'email') : null;
    recipients = user ? [{ kind: 'customer_user', principalId: user.user_id, email: user.email ?? undefined }] : [];
  } else {
    recipients = await sponsorParticipants(trx, input.customerTenant, input.ticketId, shared);
  }
  const payload: CoManagedRoutingPayload = { event: input.event, ticketId: input.ticketId, relationshipId: input.relationshipId,
    sponsorTenant: input.sponsorTenant, actorName: input.actorName, actorOrganization: input.actorOrganization };
  const rows = recipients.flatMap((r) => [
    { delivery_kind: ROUTING_IN_APP_KIND, recipient: r.principalId },
    ...(r.email ? [{ delivery_kind: ROUTING_EMAIL_KIND, recipient: r.email.trim().toLowerCase() }] : []),
  ].map((k) => ({ tenant: input.customerTenant, source_id: input.operationId, recipient_kind: r.kind, state: 'pending', attempts: 0,
    payload: JSON.stringify({ ...payload, principalId: r.principalId }), ...k })));
  if (!rows.length) return 0;
  // write-admission: exempt — outbox rows written inside the admitted transition's own transaction
  await tenantDb(trx, input.customerTenant).table('co_management_deliveries').insert(rows).onConflict(['tenant', 'delivery_kind', 'source_id', 'recipient']).ignore();
  return rows.length;
}
