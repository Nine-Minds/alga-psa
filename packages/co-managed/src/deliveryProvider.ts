import { withAdminTransaction, tenantDb } from '@alga-psa/db';
import { claimDelivery, finishDelivery, CO_MANAGED_LEDGER } from '@alga-psa/shared/lib/deliveryLedger';
import { resolveCommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  decideReplyToken, parseCm2Metadata,
  type CoManagedDeliveryProvider, type InboundAdmission, type DeliveryRecipient,
} from '@alga-psa/shared/lib/coManagedDelivery';

/**
 * Current grant generation = number of `access_revoked` handoff receipts on the ticket.
 * No generation table: the append-only receipts already are the history.
 */
async function currentGeneration(trx: any, tenant: string, ticketId: string, relationshipId: string): Promise<number | null> {
  const work = await tenantDb(trx, tenant).table('co_management_ticket_work')
    .where({ relationship_id: relationshipId, ticket_id: ticketId }).first('work_id');
  if (!work) return null;
  const row = await tenantDb(trx, tenant).table('co_management_ticket_handoffs')
    .where({ relationship_id: relationshipId, ticket_id: ticketId, transition: 'access_revoked' }).count<{ count: string }[]>('* as count');
  return Number(row?.[0]?.count ?? 0);
}

export function createCoManagedDeliveryProvider(): CoManagedDeliveryProvider {
  return {
    // Audience-aware ticket-comment planning is wired by the subscriber step (see plan §2 step 4);
    // until then a null plan keeps every subscriber on its native recipient path.
    async planTicketComment() { return null; },

    async claim(tenant, kind, sourceId, recipient: DeliveryRecipient) {
      return withAdminTransaction((trx) => claimDelivery(trx, CO_MANAGED_LEDGER, tenant,
        { delivery_kind: kind, source_id: sourceId, recipient: recipient.email ?? recipient.principalId },
        { recipient_kind: recipient.kind }));
    },

    async finish(tenant, kind, sourceId, recipient, state, outcome) {
      await withAdminTransaction((trx) => finishDelivery(trx, CO_MANAGED_LEDGER, tenant,
        { delivery_kind: kind, source_id: sourceId, recipient: recipient.email ?? recipient.principalId },
        state, { error: outcome?.error, errorCode: outcome?.code }));
    },

    async admitReplyToken(tenant, token, metadata): Promise<InboundAdmission> {
      const parsed = parseCm2Metadata(metadata);
      const generation = parsed
        ? await withAdminTransaction(async (trx) => {
            const record = await tenantDb(trx, tenant).table('email_reply_tokens').where({ token }).first('ticket_id');
            return record?.ticket_id ? currentGeneration(trx, tenant, record.ticket_id, parsed.relationshipId) : null;
          })
        : null;
      const decision = decideReplyToken(token, metadata, generation);
      if (decision.action === 'admit') {
        const thread = decision.metadata.threadId
          ? await withAdminTransaction((trx) => tenantDb(trx, tenant).table('comment_threads')
              .where({ thread_id: decision.metadata.threadId }).first('collaboration_audience', 'is_internal'))
          : null;
        const audience = resolveCommentAudience(thread ?? { is_internal: false });
        // A shared_it / organization_private thread must never receive a requester-visible email
        // comment. Email senders have no session actor, so only the requester thread is admitted;
        // anything else is refused (and quarantined by the caller) rather than written.
        if (audience !== 'requester') return { admitted: false, reason: 'audience_unsupported', acknowledge: true };
        return { admitted: true, audience, relationshipId: decision.metadata.relationshipId, threadId: decision.metadata.threadId };
      }
      if (decision.action === 'refuse') return { admitted: false, reason: decision.reason, acknowledge: true };
      return { admitted: false, reason: 'not_served', acknowledge: false };
    },
  };
}
