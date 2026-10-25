'use client';

import { useMemo, type ReactNode } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { TicketConversationAttachmentsProvider, type TicketConversationAttachmentsProps } from '@alga-psa/tickets/components';
import CoManagedCommentAttachments from './CoManagedCommentAttachments';

/** Bind the native comment slot to its qualified work and actual comment store. */
export default function CoManagedTicketAttachmentsProvider({ resource, children }: {
  resource: CoManagedSharedResource; children: ReactNode;
}) {
  const component = useMemo(() => {
    const target = { ...resource };
    return function TicketAttachments({ ticketId, comment }: TicketConversationAttachmentsProps) {
      if (target.kind !== 'ticket' || ticketId !== target.id || comment.ticket_id !== target.id ||
          !comment.tenant || !comment.thread_id || !comment.comment_id || comment.deleted_at) return null;
      return <CoManagedCommentAttachments resource={target}
        comment={{ storeTenant: comment.tenant, threadId: comment.thread_id, commentId: comment.comment_id }} />;
    };
  }, [resource]);
  return <TicketConversationAttachmentsProvider component={component}>{children}</TicketConversationAttachmentsProvider>;
}
