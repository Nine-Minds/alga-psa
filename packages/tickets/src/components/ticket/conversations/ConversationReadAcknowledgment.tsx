'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { acknowledgeNamedConversationMessagesAction } from '../../../actions/namedTicketConversationActions';

/** Mount only alongside successfully loaded selected history, never in the
 * navigator or All activity. A background tab does not consume its unread state. */
export function ConversationReadAcknowledgment({ id, ticket, conversation, messages, onChanged }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference;
  messages: readonly { commentId: string; threadId: string }[]; onChanged?: () => void;
}) {
  const { data: session } = useSession(), { t } = useTranslation('features/tickets');
  const scope = `${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${ticket.tenant}:${ticket.ticketId}:${ticket.relationshipId}:${conversation.storeTenant}:${conversation.conversationId}`;
  const selected = JSON.stringify(messages.map(({ commentId, threadId }) => ({ commentId, threadId })));
  const completed = useRef<string | null>(null), changed = useRef(onChanged); changed.current = onChanged;
  const [failure, setFailure] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const key = `${scope}:${selected}`;
  useEffect(() => {
    if (!session?.user?.id || !messages.length || completed.current === key) return;
    let current = true, working = false;
    const acknowledge = async () => {
      if (!current || working || completed.current === key || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      working = true;
      let updated = false;
      try {
        const snapshot = JSON.parse(selected) as { commentId: string; threadId: string }[];
        for (let offset = 0; offset < snapshot.length; offset += 100) {
          if (!current || document.visibilityState !== 'visible' || !document.hasFocus()) return;
          const result = await acknowledgeNamedConversationMessagesAction(ticket,
            { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }, snapshot.slice(offset, offset + 100));
          updated ||= result.changed;
        }
        if (current) { completed.current = key; setFailure(null); }
      } catch { if (current) setFailure(key); }
      finally { working = false; if (current && updated) changed.current?.(); }
    };
    // Effects run after selected history commits. Retain that exact message
    // snapshot even if another reply arrives while the action is in flight.
    void acknowledge();
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => { current = false; window.removeEventListener('focus', acknowledge); document.removeEventListener('visibilitychange', acknowledge); };
  }, [scope, selected, retry]);
  return failure === key ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
    <p>{t('namedConversations.readFailed', 'Could not mark these messages as read.')}</p>
    <Button id={`${id}-read-retry`} variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>{t('namedConversations.retry', 'Retry')}</Button>
  </div> : null;
}
