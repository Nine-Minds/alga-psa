'use client';

import type { CoManagedConversationItem } from '@alga-psa/co-managed';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { ConversationEmailEnvelope } from './ConversationEmailEnvelope';

export function ConversationMessageDetails({ id, ticket, conversation, email, attachments }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference;
  email?: CoManagedConversationItem['email'] | null; attachments?: CoManagedConversationItem['attachments'];
}) {
  return <>
    {email && <ConversationEmailEnvelope email={email} />}
    {Boolean(attachments?.length) && <ul className="my-2 flex flex-wrap gap-2">
      {attachments!.map(file => {
        const query = new URLSearchParams({ ticketTenant: ticket.tenant, ticketId: ticket.ticketId, conversationId: conversation.conversationId,
          storeTenant: file.storeTenant, threadId: file.threadId, commentId: file.commentId, ...(ticket.relationshipId ? { relationshipId: ticket.relationshipId } : {}) });
        return <li key={file.attachmentId}><a id={`${id}-file-${file.attachmentId}`} download
          href={`/api/tickets/conversation-attachments/${encodeURIComponent(file.attachmentId)}?${query}`}
          className="inline-flex rounded border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm text-primary-600 underline break-all">{file.fileName}</a></li>;
      })}
    </ul>}
  </>;
}
