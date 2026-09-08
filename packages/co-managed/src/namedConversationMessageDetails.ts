import type { Knex } from 'knex';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedConversationItem } from './ticketConversation';
import { withNamedTicketConversation } from './namedTicketConversations';
import { namedConversationMessageContext, attachNamedConversationFiles } from './namedConversationAttachments';
import { attachPublishedConversationEmails } from './conversationEmailOperations';
import { conversationUuid, TicketConversationError, type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';

/** Decorate existing native history without loading a second body/author stream.
 * Every requested message must still belong to the current authorized root. */
export function getNamedConversationMessageDetails(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, input: { commentId: string; threadId: string }[]) {
  if (!Array.isArray(input) || input.length > 25 || input.some(item => !item || ![item.commentId, item.threadId].every(conversationUuid) ||
    Object.keys(item).some(key => !['commentId', 'threadId'].includes(key)))) throw new TicketConversationError('CONVERSATION_INVALID');
  const selected = input.map(item => ({ commentId: item.commentId.toLowerCase(), threadId: item.threadId.toLowerCase() }));
  return withNamedTicketConversation(db, actor, ticket, conversation, 'read', async context => {
    const items: Pick<CoManagedConversationItem, 'commentId' | 'threadId' | 'storeTenant' | 'deleted' | 'email' | 'attachments' | 'author'>[] = [];
    for (const item of selected) {
      try { await namedConversationMessageContext(context, item.commentId, item.threadId); }
      catch (error) {
        if (error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN') continue;
        throw error;
      }
      items.push({ ...item, storeTenant: context.conversation.storeTenant, deleted: false });
    }
    if (context.conversation.transport === 'email') await attachPublishedConversationEmails(context, items);
    await attachNamedConversationFiles(context, items);
    return items.map(item => ({ commentId: item.commentId, email: item.email ?? null, attachments: item.attachments ?? [] }));
  });
}
