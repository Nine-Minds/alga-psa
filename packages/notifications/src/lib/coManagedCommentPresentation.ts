import { ticketConversationMessageLink } from '@alga-psa/shared/lib/tickets/conversationLinks';
import type { CoManagedTicketCommentNotification, CoManagedTaskCommentNotification, NamedConversationNotification } from '@alga-psa/co-managed';
// LEVERAGE: friction shared-rich-text-preview — this pure text reader belongs below the ticket feature.
import { extractTicketRichTextPlainText } from '@alga-psa/tickets/lib/ticketRichText';

export function coManagedCommentPresentation(message: CoManagedTicketCommentNotification | CoManagedTaskCommentNotification | NamedConversationNotification, eventId: string, deliveryKey: string) {
  const authorName = message.author?.displayName
    ? [message.author.displayName, message.author.organizationName ? `(${message.author.organizationName})` : ''].filter(Boolean).join(' ')
    : '—';
  const commentPreview = Array.from(extractTicketRichTextPlainText(message.note)).slice(0, 200).join('');
  if ('conversation' in message) {
    return {
      link: namedConversationNotificationLink(message),
      data: { authorName, ticketId: message.ticketNumber ?? '—', commentPreview: `${message.conversation.name}: ${commentPreview}` },
      metadata: { coManaged: { version: 3, resource: message.resource, conversation: { storeTenant: message.conversation.storeTenant, conversationId: message.conversation.conversationId },
        commentId: message.commentId, threadId: message.threadId, sequence: message.sequence, deliveryKey, eventId: eventId.toLowerCase() } },
    };
  }
  if (message.resource.kind === 'project_task') {
    const task = message as CoManagedTaskCommentNotification;
    return {
      link: task.ownerTaskPath ?? `/msp/co-management/tasks/${task.resource.tenant}/${task.resource.relationshipId}/${task.resource.id}`,
      data: { authorName, taskName: task.taskName ?? '—', projectName: task.projectName ?? '—', commentPreview },
      metadata: { coManaged: { version: 2, resource: task.resource, commentId: task.commentId, threadId: task.threadId,
        audience: task.audience, deliveryKey, eventId: eventId.toLowerCase(), ...(task.author ? { author: task.author } : {}) } },
    };
  }
  const ticket = message as CoManagedTicketCommentNotification;
  return {
    link: ticketConversationMessageLink(`/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`, ticket.conversationTarget, message.commentId),
    data: { authorName, ticketId: ticket.ticketNumber ?? '—', commentPreview },
    metadata: { coManaged: { version: 1, resource: message.resource, commentId: message.commentId, threadId: message.threadId,
      audience: message.audience, deliveryKey, eventId: eventId.toLowerCase(), ...(message.author ? { author: message.author } : {}) } },
  };
}

export function namedConversationNotificationLink(message: NamedConversationNotification): string {
  const path = message.ownerTicket ? `/msp/tickets/${message.resource.id}` : `/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`;
  return ticketConversationMessageLink(path, message.conversation, message.commentId);
}
