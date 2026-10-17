'use client';

import type { CoManagedConversationItem } from '@alga-psa/co-managed';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { ConversationEmailEnvelope } from './ConversationEmailEnvelope';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useConversationSharing } from './ConversationSharingContext';

export function ConversationMessageDetails({ id, ticket, conversation, email, attachments, sharedFrom }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference;
  email?: CoManagedConversationItem['email'] | null; attachments?: CoManagedConversationItem['attachments'];
  sharedFrom?: CoManagedConversationItem['sharedFrom'];
}) {
  return <>
    {email && <ConversationEmailEnvelope email={email} />}
    {sharedFrom && <ConversationShareSourceLink id={id} source={sharedFrom} />}
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

export function ConversationShareSourceLink({ id, source }: { id: string; source: NonNullable<CoManagedConversationItem['sharedFrom']> }) {
  const params = useSearchParams(), sharing = useConversationSharing(), { t } = useTranslation('features/tickets');
  const query = new URLSearchParams(params?.toString());
  for (const key of ['conversationView', 'replyTo', 'replyThread']) query.delete(key);
  query.set('conversation', source.conversation.conversationId); query.set('conversationStore', source.conversation.storeTenant); query.set('message', source.commentId);
  return <a id={`${id}-shared-source-${source.commentId}`} href={`?${query}`} className="my-1 inline-block text-xs text-primary-600 underline break-words"
    onClick={event => {
      if (!sharing?.openSource || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); void sharing.openSource(source);
    }}>{t('namedConversations.share.sourceLink', { name: source.conversation.name, defaultValue: 'Shared from {{name}}' })}</a>;
}
