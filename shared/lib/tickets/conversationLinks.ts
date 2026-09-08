import type { TicketConversationReference } from './namedConversations';

/** Extend an already selected native/shared/portal route without replacing its
 * tenant query or fragment. Callers supply an authorized source reference. */
export function ticketConversationMessageLink(path: string, conversation: TicketConversationReference | undefined, commentId: string): string {
  if (!conversation) return path;
  const absolute = /^https?:\/\//i.test(path), url = new URL(path, 'https://alga.invalid');
  url.searchParams.set('conversation', conversation.conversationId);
  url.searchParams.set('conversationStore', conversation.storeTenant);
  url.searchParams.set('message', commentId);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}
