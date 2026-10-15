import type { Knex } from 'knex';
import type { WorkflowActor } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { TicketModelEventPublisher as SharedTicketModelEventPublisher } from '@alga-psa/shared/services/tickets/ticketModelEventPublisher';
import { buildModelPublisherTicketCommentAddedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { retainNativeConversationEvent } from '../nativeConversationEvents';

type CommentCreated = Parameters<SharedTicketModelEventPublisher['publishCommentCreated']>[0];

/**
 * The PSA model publisher plus co-managed comment retention. A comment event is
 * retained inside the comment's own transaction (so a co-managed mirror never
 * misses it); ordinary PSA publication still runs after commit. Lives here
 * rather than in shared because retention needs @alga-psa/co-managed.
 */
export class TicketModelEventPublisher extends SharedTicketModelEventPublisher {
  readonly transactionalCommentEvents = true as const;

  constructor(
    private readonly commentTrx?: Knex.Transaction,
    options?: ConstructorParameters<typeof SharedTicketModelEventPublisher>[1],
  ) {
    super(commentTrx, options);
  }

  async publishCommentCreated(data: CommentCreated): Promise<void> {
    if (!this.commentTrx?.isTransaction) throw new Error('Comment publication requires its owning transaction');
    const actor: WorkflowActor = data.actor
      ?? (data.userId ? { actorType: 'USER', actorUserId: data.userId } : { actorType: 'SYSTEM' });
    await retainNativeConversationEvent(this.commentTrx, { tenant: data.tenantId, ticketId: data.ticketId, commentId: data.commentId }, {
      kind: 'event', eventType: 'TICKET_COMMENT_ADDED', payload: {
        tenantId: data.tenantId, ticketId: data.ticketId, commentId: data.commentId, userId: data.userId,
        comment: { id: data.commentId, content: data.metadata?.content ?? '', author: data.metadata?.author ?? 'System',
          authorType: data.metadata?.author_type, isInternal: data.metadata?.isInternal ?? false },
      },
    }, {
      // Runs after commit; the retained copy is the co-managed path.
      legacyPublish: () => publishWorkflowEvent({
        eventType: 'TICKET_COMMENT_ADDED',
        payload: buildModelPublisherTicketCommentAddedPayload(data),
        ctx: { tenantId: data.tenantId, actor },
      }),
    });
  }
}
