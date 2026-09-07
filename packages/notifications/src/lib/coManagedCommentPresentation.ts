import type { CoManagedTicketCommentNotification } from '@alga-psa/co-managed';
// LEVERAGE: friction shared-rich-text-preview — this pure text reader belongs below the ticket feature.
import { extractTicketRichTextPlainText } from '@alga-psa/tickets/lib/ticketRichText';

export function coManagedCommentPresentation(message: CoManagedTicketCommentNotification, eventId: string, deliveryKey: string) {
  const authorName = message.author?.displayName
    ? [message.author.displayName, message.author.organizationName ? `(${message.author.organizationName})` : ''].filter(Boolean).join(' ')
    : '—';
  const commentPreview = Array.from(extractTicketRichTextPlainText(message.note)).slice(0, 200).join('');
  return {
    link: `/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`,
    data: { authorName, ticketId: message.ticketNumber ?? '—', commentPreview },
    metadata: { coManaged: { version: 1, resource: message.resource, commentId: message.commentId, threadId: message.threadId,
      audience: message.audience, deliveryKey, eventId: eventId.toLowerCase(), ...(message.author ? { author: message.author } : {}) } },
  };
}
