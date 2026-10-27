import { registerAfterCommit } from '@alga-psa/db';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import { publishCommentEvent } from '../commentEventRegistry';

/**
 * The shared publisher with comment publication routed through the comment-event
 * registry. With no contributor registered the native publication runs unchanged.
 * Not instantiated by any native path in this card.
 */
export class TicketModelEventPublisher extends ServerEventPublisher {
  private readonly commentTrx?: Parameters<typeof registerAfterCommit>[0];

  constructor(trx?: Parameters<typeof registerAfterCommit>[0]) {
    super(trx);
    this.commentTrx = trx;
  }

  override async publishCommentCreated(data: Parameters<ServerEventPublisher['publishCommentCreated']>[0]): Promise<void> {
    const native = () => super.publishCommentCreated(data);
    if (!this.commentTrx) return native();
    await publishCommentEvent(this.commentTrx as any, 'ticket', { ...data }, native);
  }
}
