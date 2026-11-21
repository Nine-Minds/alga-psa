import { getAdminConnection } from '@alga-psa/db';
import { coManagedInboundCommentSeam } from '@alga-psa/shared/lib/coManagedDelivery';
import { withCoManagedMailCredential } from './sharedWorkIdentity';
import { createSharedTicketComment } from './sharedTicketCommentWriter';
import { recordRefusalAck, sendRefusalAck } from './refusalAck';

/**
 * Registers the writer for admitted shared_it / organization_private email replies (CM L5).
 * It reuses L4a's writer (`createSharedTicketComment` -> `createCoManagedTicketComment`) so the
 * audience is stamped on the thread, response state and publication intent are written in the same
 * transaction, and the command receipt makes a replayed message a no-op. The only difference from a
 * browser comment is the credential: a verified inbound-mail scope instead of a session row.
 */
export function registerCoManagedInboundCommentWriter(): void {
  if (coManagedInboundCommentSeam.hasProvider()) return;
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
     * The one acknowledgement for a refused token: recorded as a durable intent first, then sent
     * here when this process has a mail provider (email-service does not; the recovery job sends
     * it from one that does). See `refusalAck.ts`. Never returns without the ack sent or queued.
     */
    async acknowledgeRefusal({ tenant, token, to, ticketId }) {
      await recordRefusalAck({ tenant, token, to, ticketId });
      await sendRefusalAck({ tenant, token, to, ticketId });
    },
  }));
}
