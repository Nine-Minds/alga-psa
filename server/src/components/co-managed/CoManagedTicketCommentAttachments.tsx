'use client';

import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { TicketConversationAttachmentsProps } from './conversationSlotProps';
import CoManagedCommentAttachments from './CoManagedCommentAttachments';

/** Bound to a qualified work item and the actual comment store; mounted by the
 * `ticket.conversation.comment-attachments` slot host on a shared ticket. */
export default function CoManagedTicketCommentAttachments({ resource, ticketId, comment }: TicketConversationAttachmentsProps & {
  resource: CoManagedSharedResource | null;
}) {
  if (!resource || resource.kind !== 'ticket' || ticketId !== resource.id || comment.ticket_id !== resource.id ||
      !comment.tenant || !comment.thread_id || !comment.comment_id || comment.deleted_at) return null;
  return <CoManagedCommentAttachments resource={{ ...resource }}
    comment={{ storeTenant: comment.tenant, threadId: comment.thread_id, commentId: comment.comment_id }} />;
}
