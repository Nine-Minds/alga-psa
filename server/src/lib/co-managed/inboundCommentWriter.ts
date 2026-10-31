import { createHash } from 'node:crypto';
import { getAdminConnection } from '@alga-psa/db';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import { AUTO_GENERATED_MAIL_HEADERS } from '@shared/lib/email/automatedMessage';
import { CO_MANAGED_LEDGER, claimDelivery, finishDelivery } from '@alga-psa/shared/lib/deliveryLedger';
import { coManagedInboundCommentSeam } from '@alga-psa/shared/lib/coManagedDelivery';
import { withCoManagedMailCredential } from '@alga-psa/co-managed/sharedWorkIdentity';
import { createSharedTicketComment } from './createTicketComment';

/**
 * Registers the writer for admitted shared_it / organization_private email replies (CM L5).
 * It reuses L4a's writer (`createSharedTicketComment` -> `createCoManagedTicketComment`) so the
 * audience is stamped on the thread, response state and publication intent are written in the same
 * transaction, and the command receipt makes a replayed message a no-op. The only difference from a
 * browser comment is the credential: a verified inbound-mail scope instead of a session row.
 */
if (!coManagedInboundCommentSeam.hasProvider()) {
  coManagedInboundCommentSeam.register(() => ({
    async write(input) {
      const db = await getAdminConnection();
      const resource = { tenant: input.tenant, relationshipId: input.relationshipId, kind: 'ticket' as const, id: input.ticketId };
      // The credential's session id is the message-derived operation id: it never names a real session.
      const actor = { kind: 'session' as const, tenant: input.actor.tenant, userId: input.actor.userId, sessionId: input.operationId };
      const request = input.threadId && input.parentCommentId
        ? { operationId: input.operationId, text: input.text,
            parent: { storeTenant: input.tenant, threadId: input.threadId, commentId: input.parentCommentId }, expectedAudience: input.audience }
        : { operationId: input.operationId, text: input.text, audience: input.audience };
      const receipt = await withCoManagedMailCredential({ tenant: actor.tenant, userId: actor.userId, sessionId: actor.sessionId },
        () => createSharedTicketComment(db, actor, resource, request));
      return { commentId: receipt.commentId };
    },
    /**
     * The one acknowledgement for a refused token. The ledger row is keyed by (token, sender), so a
     * redelivered or repeated reply to the same token never produces a second mail. The mail carries
     * RFC 3834 auto-generated headers; the caller has already
     * skipped automated senders, so two auto-responders cannot ping-pong.
     */
    async acknowledgeRefusal({ tenant, token, to, ticketId }) {
      const db = await getAdminConnection();
      const hex = createHash('sha256').update(`co-managed-refusal-ack:${tenant}:${token}`).digest('hex');
      const key = { delivery_kind: 'inbound_refusal_ack', source_id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`, recipient: to };
      if (!await claimDelivery(db, CO_MANAGED_LEDGER, tenant, key, { recipient_kind: 'requester_contact', payload: JSON.stringify({ ticketId }) })) return;
      const subject = 'Your reply could not be added to the conversation';
      const text = 'We received your reply but could not add it to the conversation it referred to. It may no longer be open to you. No further action was taken.';
      const html = `<p>${text}</p>`;
      try {
        await TenantEmailService.getInstance(tenant).sendEmail({
          mailClass: 'ticket', to, tenantId: tenant, entityType: 'ticket', entityId: ticketId,
          templateProcessor: new StaticTemplateProcessor(subject, html, text),
          headers: { ...AUTO_GENERATED_MAIL_HEADERS },
        });
        await finishDelivery(db, CO_MANAGED_LEDGER, tenant, key, 'sent');
      } catch (error) {
        const e = error as { message?: string; errorCode?: string; metadata?: Record<string, unknown> };
        await finishDelivery(db, CO_MANAGED_LEDGER, tenant, key, e.metadata?.definitelyNotSent === true ? 'failed' : 'sending',
          { error: e.message, errorCode: e.errorCode });
        throw error;
      }
    },
  }));
}
