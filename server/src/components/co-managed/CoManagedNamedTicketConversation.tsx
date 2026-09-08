'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks/useFeatureFlag';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useNamedTicketConversations } from '@alga-psa/tickets/components/ticket/conversations/useNamedTicketConversations';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import CoManagedTicketConversation from './CoManagedTicketConversation';

/** Requester keeps its canonical customer notification/reply path while the
 * common navigator and author-private side composers use qualified home actors. */
export default function CoManagedNamedTicketConversation({ resource }: { resource: CoManagedSharedResource }) {
  const { enabled } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const named = useNamedTicketConversations({ tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }, enabled,
    'co-ticket-named', { requesterPanel: props => <RequesterConversation resource={resource} {...props} /> });
  if (!enabled) return <CoManagedTicketConversation resource={resource} />;
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(12rem,17rem)_minmax(0,1fr)]">
    <aside className="min-w-0">{named.navigator}</aside><div className="min-w-0">{named.panel}</div>
  </div>;
}
function RequesterConversation({ resource, conversation, flush, onDirty }: { resource: CoManagedSharedResource;
  conversation: NamedTicketConversation; flush: MutableRefObject<() => Promise<boolean>>; onDirty: (dirty: boolean) => void }) {
  const active = useRef(false);
  const [editing, setEditing] = useState(false), { t } = useTranslation('features/tickets');
  const onDraftState = useCallback((value: boolean) => { active.current = value; setEditing(value); onDirty(value); }, [onDirty]);
  useEffect(() => {
    const check = async () => !active.current;
    flush.current = check;
    return () => { if (flush.current === check) flush.current = async () => true; };
  }, [flush]);
  return <div className="space-y-3">
    {editing && <p role="status" className="text-sm text-muted-foreground">{t('namedConversations.finishRequesterEdit', 'Finish or cancel your current edit before switching conversations.')}</p>}
    <CoManagedTicketConversation resource={resource}
      requester={{ storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }} onDraftState={onDraftState} />
  </div>;
}
