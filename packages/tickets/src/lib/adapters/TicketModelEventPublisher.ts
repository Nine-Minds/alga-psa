import type { Knex } from 'knex';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import { publishCommentEvent } from '@alga-psa/db/commentEventRegistry';

type CommentCreatedData = Parameters<ServerEventPublisher['publishCommentCreated']>[0];

/**
 * The shared publisher with comment publication routed through the comment-event
 * registry. With no contributor registered the native publication runs unchanged.
 * Not instantiated by any native path in this card.
 */
export class TicketModelEventPublisher extends ServerEventPublisher {
  private readonly commentTrx?: Knex.Transaction;

  constructor(trx?: Knex.Transaction) {
    super(trx);
    this.commentTrx = trx;
  }

  override async publishCommentCreated(data: CommentCreatedData): Promise<void> {
    const native = () => super.publishCommentCreated(data);
    if (!this.commentTrx) return native();
    await publishCommentEvent(this.commentTrx, 'ticket', {
      eventType: 'TICKET_COMMENT_ADDED',
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      commentId: data.commentId,
      userId: data.userId,
      actor: data.actor,
      metadata: data.metadata,
    }, native);
  }
}
