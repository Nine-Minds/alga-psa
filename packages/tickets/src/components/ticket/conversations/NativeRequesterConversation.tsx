'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { IComment } from '@alga-psa/types';
import type { NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { ConversationDraftParent } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { getNamedConversationMessageDetailsAction } from '../../../actions/namedTicketConversationActions';
import { ConversationMessageDetails } from './ConversationMessageDetails';
import { ConversationReadAcknowledgment } from './ConversationReadAcknowledgment';
import { useConversationMessageTarget } from './useConversationMessageFocus';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { NamedConversationComposer } from './useNamedTicketConversations';

export interface RequesterHistoryComposition {
  ready: boolean;
  focusedMessageId?: string | null;
  renderDetails?: (comment: IComment) => ReactNode;
  afterChange: () => Promise<void>;
  beforeEdit: () => Promise<boolean>;
  reply: (comment: IComment) => Promise<boolean>;
}

/** History owns existing edits/reactions and its layout preference; the named
 * composer owns the private draft, reply target and reviewed external Send. */
export function NativeRequesterConversation({ id, conversation, flush, onDirty, canWrite, onRefresh, onPublished, editing, renderHistory, historyComments, refreshVersion = 0 }: {
  id: string; conversation: NamedTicketConversation; flush: MutableRefObject<() => Promise<boolean>>;
  onDirty: (dirty: boolean) => void; canWrite: boolean; onRefresh: () => void; onPublished: () => Promise<void>;
  historyComments?: () => IComment[]; refreshVersion?: number;
  editing: () => boolean; renderHistory: (composition: RequesterHistoryComposition) => ReactNode;
}) {
  const { t } = useTranslation('features/tickets');
  const router = useRouter(), params = useSearchParams();
  const ticket = useMemo(() => ({ ...conversation.ticket }), [conversation.ticket.tenant, conversation.ticket.ticketId, conversation.ticket.relationshipId]);
  const messageTarget = useConversationMessageTarget(ticket.tenant, conversation);
  const composerFlush = useRef(async () => true), reply = useRef<((parent: ConversationDraftParent) => Promise<boolean>) | null>(null);
  const [ready, setReady] = useState(false), [draft, setDraft] = useState(false);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getNamedConversationMessageDetailsAction>>>([]);
  const [detailsError, setDetailsError] = useState(false), [retryDetails, setRetryDetails] = useState(0);
  const [loadedDetailsKey, setLoadedDetailsKey] = useState<string | null>(null);
  const selectedComments = (historyComments?.() ?? []).filter(comment => !comment.deleted_at && !comment.is_internal &&
    (!comment.publish_state || comment.publish_state === 'published') && comment.comment_id && comment.thread_id)
    .map(comment => ({ commentId: comment.comment_id!, threadId: comment.thread_id! }));
  const commentsKey = JSON.stringify(selectedComments);
  const detailsKey = `${conversation.storeTenant}:${conversation.conversationId}:${commentsKey}:${refreshVersion}:${retryDetails}`;
  const focusedMessageId = messageTarget && loadedDetailsKey === detailsKey && selectedComments.some(item => item.commentId.toLowerCase() === messageTarget.toLowerCase()) ? messageTarget.toLowerCase() : null;
  useEffect(() => {
    let current = true;
    setDetails([]); setDetailsError(false);
    const read = async () => {
      const comments = JSON.parse(commentsKey) as { commentId: string; threadId: string }[];
      const all: Awaited<ReturnType<typeof getNamedConversationMessageDetailsAction>> = [];
      for (let offset = 0; offset < comments.length; offset += 25) {
        const items = await getNamedConversationMessageDetailsAction(ticket,
          { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }, comments.slice(offset, offset + 25));
        if (!current) return;
        all.push(...items);
      }
      if (current) { setDetails(all); setLoadedDetailsKey(detailsKey); }
    };
    read().catch(() => { if (current) { setDetails([]); setDetailsError(true); } });
    return () => { current = false; };
  }, [ticket, conversation.storeTenant, conversation.conversationId, commentsKey, refreshVersion, retryDetails]);
  const renderDetails = (comment: IComment) => {
    const item = details.find(value => value.commentId === comment.comment_id);
    return item ? <ConversationMessageDetails id={id} ticket={ticket} conversation={conversation} {...item} /> : null;
  };
  const editingNow = editing();
  const state = useRef({ editing: editingNow, ready, canWrite }); state.current = { editing: editingNow, ready, canWrite };
  useEffect(() => { onDirty(editingNow || draft); return () => onDirty(false); }, [editingNow, draft, onDirty]);
  useEffect(() => {
    const check = async () => !state.current.editing && await composerFlush.current();
    flush.current = check;
    return () => { if (flush.current === check) flush.current = async () => true; };
  }, [flush]);
  const beforeEdit = useCallback(async () => state.current.canWrite && state.current.ready && !state.current.editing &&
    await composerFlush.current() && state.current.canWrite && state.current.ready && !state.current.editing, []);
  const respond = useCallback(async (comment: IComment) => {
    if (!state.current.canWrite || !state.current.ready || state.current.editing || !comment.comment_id || !comment.thread_id) return false;
    return Boolean(await reply.current?.({ commentId: comment.comment_id, threadId: comment.thread_id }));
  }, []);
  usePageCreateShortcut(() => {
    const editor = document.getElementById(`${id}-composer`);
    editor?.scrollIntoView({ block: 'nearest' });
    (editor?.querySelector<HTMLElement>('[contenteditable="true"]') ?? editor)?.focus();
  }, { enabled: canWrite && ready && !editingNow });
  // The existing submit shortcut opens review; confirmation still has its own
  // visible action and cannot be bypassed by a legacy history composer.
  useDialogSubmitShortcut(() => { document.getElementById(`${id}-review-email`)?.click(); }, {
    active: draft && canWrite && ready && !editingNow, enabled: draft && canWrite && ready && !editingNow,
  });
  return <div className="space-y-3">
    {messageTarget && loadedDetailsKey === detailsKey && !detailsError && !focusedMessageId && <p role="alert" className="text-sm">{t('namedConversations.messageUnavailable', 'This message is unavailable in this conversation.')}</p>}
    {messageTarget && <Button id={`${id}-latest`} variant="ghost" size="sm" onClick={() => {
      const query = new URLSearchParams(params?.toString()); query.delete('message');
      router.push(`${window.location.pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
    }}>{t('namedConversations.latest', 'Show latest messages')}</Button>}
    {(!messageTarget || focusedMessageId) && !detailsError && loadedDetailsKey === detailsKey && <ConversationReadAcknowledgment id={id} ticket={ticket}
      conversation={conversation} messages={selectedComments.filter(comment => details.some(item => item.commentId === comment.commentId))} onChanged={onRefresh} />}
    {editingNow && <p role="status" className="text-sm text-muted-foreground">{t('namedConversations.finishRequesterEdit', 'Finish or cancel your current edit before switching conversations.')}</p>}
    {detailsError && <div role="alert" className="text-sm"><p>{t('namedConversations.detailsUnavailable', 'Email and attachment details are unavailable.')}</p><Button id={`${id}-details-retry`} variant="ghost" onClick={() => setRetryDetails(value => value + 1)}>{t('namedConversations.retry', 'Retry')}</Button></div>}
    {renderHistory({ renderDetails, focusedMessageId, ready: canWrite && ready && !editingNow, beforeEdit, reply: respond, afterChange: async () => { await onPublished(); onRefresh(); } })}
    {canWrite && <fieldset disabled={editingNow} inert={editingNow} className="min-w-0 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
      <NamedConversationComposer id={id} ticket={ticket} conversation={conversation} flush={composerFlush}
        onDirty={setDraft} disabled={editingNow} reply={reply} onReplyReady={setReady} onRefresh={onRefresh} showScheduledReplies={false} deliveryRefreshVersion={refreshVersion}
        onPosted={async () => { await onPublished(); onRefresh(); }} />
    </fieldset>}
  </div>;
}
