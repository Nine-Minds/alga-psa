import type { InboundConversationEventRetainer } from '../../../shared/services/email/inboundConversationEvents';
import { retainCoManagedNativeCommentEvent } from './nativeConversationEvents';

/** Inbox composition keeps the shared worker independent of the co-managed domain. */
export const retainCoManagedInboundCommentEvent: InboundConversationEventRetainer = (trx, input, publish) =>
  retainCoManagedNativeCommentEvent(trx, { ...input, publication: { kind: 'event', eventType: 'TICKET_COMMENT_ADDED',
    payload: input.payload, ...(input.channel ? { channel: input.channel } : {}) } }, async (event, id) => {
    if (event.kind !== 'event') throw new Error('Unexpected inbound conversation publication');
    await publish({ eventType: event.eventType, payload: event.payload, channel: event.channel }, id);
  });
