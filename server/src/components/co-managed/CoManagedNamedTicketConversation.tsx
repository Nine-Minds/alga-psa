'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks/useFeatureFlag';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { NamedConversationComposer, useNamedTicketConversations } from '@alga-psa/tickets/components/ticket/conversations/useNamedTicketConversations';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { ConversationDraftParent } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import CoManagedTicketConversation from './CoManagedTicketConversation';

/** Preserve qualified history actions while the requester uses the same private
 * drafts, selected files and reviewed email sender as the other conversations. */
export default function CoManagedNamedTicketConversation({ resource }: { resource: CoManagedSharedResource }) {
  const { enabled } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const named = useNamedTicketConversations({ tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }, enabled,
    'co-ticket-named', { requesterPanel: props => <RequesterConversation resource={resource} {...props} /> });
  if (!enabled) return <CoManagedTicketConversation resource={resource} />;
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(12rem,17rem)_minmax(0,1fr)]">
    <aside className="min-w-0">{named.navigator}</aside><div className="min-w-0">{named.panel}</div>
  </div>;
}
function RequesterConversation({ resource, conversation, flush, onDirty, canWrite, onRefresh }: { resource: CoManagedSharedResource;
  conversation: NamedTicketConversation; flush: MutableRefObject<() => Promise<boolean>>; onDirty: (dirty: boolean) => void;
  canWrite: boolean; onRefresh: () => void }) {
  const ticket = useMemo(() => ({ tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }),
    [resource.tenant, resource.id, resource.relationshipId]);
  const activeEdit = useRef(false), ready = useRef(false);
  const composerFlush = useRef(async () => true);
  const reply = useRef<((parent: ConversationDraftParent) => Promise<boolean>) | null>(null);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(false), [replyReady, setReplyReady] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0), { t } = useTranslation('features/tickets');
  const onDraftState = useCallback((value: boolean) => { activeEdit.current = value; setEditing(value); }, []);
  const onReady = useCallback((value: boolean) => { ready.current = value; setReplyReady(value); }, []);
  useEffect(() => { onDirty(editing || draft); return () => onDirty(false); }, [editing, draft, onDirty]);
  useEffect(() => {
    const check = async () => !activeEdit.current && await composerFlush.current();
    flush.current = check;
    return () => { if (flush.current === check) flush.current = async () => true; };
  }, [flush]);
  const beforeEdit = useCallback(async () => ready.current && await composerFlush.current() && ready.current && !activeEdit.current, []);
  const respond = useCallback(async (parent: ConversationDraftParent) => !activeEdit.current && ready.current && Boolean(await reply.current?.(parent)), []);
  return <div className="space-y-3">
    {editing && <p role="status" className="text-sm text-muted-foreground">{t('namedConversations.finishRequesterEdit', 'Finish or cancel your current edit before switching conversations.')}</p>}
    <CoManagedTicketConversation resource={resource}
      requester={{ storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }} onDraftState={onDraftState}
      composition={{ ready: canWrite && replyReady, beforeEdit, reply: respond, refreshVersion }} />
    {canWrite && <fieldset disabled={editing} inert={editing} className="min-w-0" aria-label={t('namedConversations.requesterEmail', 'Requester email')}>
      <NamedConversationComposer id="co-ticket-named" ticket={ticket} conversation={conversation} flush={composerFlush}
        onDirty={setDraft} disabled={editing} reply={reply} onReplyReady={onReady} onRefresh={onRefresh}
        onPosted={() => { setRefreshVersion(value => value + 1); onRefresh(); }} />
    </fieldset>}
  </div>;
}
