'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { updateNamedConversationPreferenceAction } from '../../../actions/namedTicketConversationActions';

export type ConversationAttention = {
  following: boolean;
  lastReadVersion: string;
  attentionVersion: string;
  unreadCount: number;
};

/** Marking read acknowledges only the displayed snapshot. A reply arriving
 * while this request is in flight remains unread. Neither operation flushes
 * or reloads the author's private composer. */
export function ConversationAttentionControls({ id, ticket, conversation, attention, onChanged }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference;
  attention: ConversationAttention; onChanged: () => void;
}) {
  const { t } = useTranslation('features/tickets');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const alive = useRef(false), working = useRef(false);
  const pending = useRef<{ following?: boolean; readThrough?: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = async (preference: { following?: boolean; readThrough?: string }) => {
    if (working.current) return;
    working.current = true; pending.current ??= preference;
    setBusy(true); setFailed(false);
    try {
      await updateNamedConversationPreferenceAction(ticket, conversation, pending.current);
      if (alive.current) { pending.current = null; onChanged(); }
    } catch { if (alive.current) setFailed(true); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="space-y-1 px-2 pb-2">
    <div className="flex flex-wrap gap-1">
      <Button id={`${id}-follow`} size="sm" variant="ghost" aria-pressed={attention.following}
        disabled={busy || failed} onClick={() => void update({ following: !attention.following })}>
        {attention.following ? t('namedConversations.following', 'Following') : t('namedConversations.follow', 'Follow')}
      </Button>
      {attention.unreadCount > 0 && <Button id={`${id}-mark-read`} size="sm" variant="ghost" disabled={busy || failed}
        onClick={() => void update({ readThrough: attention.attentionVersion })}>
        {t('namedConversations.markRead', 'Mark as read')}
      </Button>}
    </div>
    {failed && <div role="alert" className="text-xs text-destructive">
      <p>{t('namedConversations.attentionUpdateFailed', 'Could not update your conversation preference.')}</p>
      <Button id={`${id}-attention-retry`} size="sm" variant="ghost" disabled={busy}
        onClick={() => { if (pending.current) void update(pending.current); }}>{t('namedConversations.retry', 'Retry')}</Button>
    </div>}
  </div>;
}
