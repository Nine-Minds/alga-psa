'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import type { CoManagedSharedWorkSummary } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createCoManagedSharedTicketDataSource, sharedTicketOptions, sharedTicketRecord } from '@/lib/co-managed/sharedTicketDataSource';
import { conversationAuthorMaps } from '@/lib/co-managed/sharedConversationMapping';
import { createSharedConversationSession } from './sharedConversationSession';

/**
 * The standard ticket screen, mounted over a co-managed shared ticket. The ticket's fields are
 * read-only; its conversation is loaded through the admitted conversation command and posted
 * through the registered comment writer, so MSP staff can write to the audiences the server
 * grants them. The screen is not forked: an app-layer data source (see sharedTicketDataSource)
 * is injected through the provider and everything else is TicketDetails.
 */
export default function CoManagedSharedTicket({ summary, backHref }: { summary: CoManagedSharedWorkSummary; backHref: string }) {
  const { t } = useTranslation('features/tickets');
  const tRef = useRef(t);
  tRef.current = t;
  const session = useMemo(() => createSharedConversationSession(summary.resource, { t: (key, fallback) => tRef.current(key, fallback) }), [summary.resource]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const load = useCallback(() => {
    setState('loading');
    session.load().then(() => setState('ready'), () => setState('failed'));
  }, [session]);
  useEffect(() => { load(); }, [load]);

  // Until the conversation is admitted (or when it cannot be loaded) the screen stays fully read-only.
  const dataSource = useMemo(
    () => createCoManagedSharedTicketDataSource(summary, backHref, state === 'ready' ? session : undefined),
    [summary, backHref, session, state],
  );
  const ticketData = useMemo(() => {
    const snapshot = state === 'ready' ? session.snapshot() : null;
    const maps = snapshot ? conversationAuthorMaps(snapshot.items, snapshot.actor) : { userMap: {}, contactMap: {} };
    return {
      ticket: sharedTicketRecord(summary), comments: session.comments(), documents: [], client: null, contacts: [], contactInfo: null,
      createdByUser: null, board: null, additionalAgents: [], availableAgents: [], userMap: maps.userMap,
      options: sharedTicketOptions(summary), categories: [], clients: [], locations: [], agentSchedules: [],
    };
  }, [summary, session, state]);

  if (state === 'loading') {
    return <p id="co-managed-shared-ticket-loading" role="status" className="p-6 text-sm text-[rgb(var(--color-text-600))]">
      {t('conversation.shared.loading', 'Loading the conversation...')}
    </p>;
  }
  return <div id="co-managed-shared-ticket" className="bg-[rgb(var(--color-app-ground))]">
    {state === 'failed' && (
      <div id="co-managed-shared-ticket-conversation-error" role="alert" className="flex items-center gap-3 p-4 text-sm">
        <span>{t('conversation.shared.loadError', 'The conversation could not be loaded.')}</span>
        <Button id="co-managed-shared-ticket-reload" variant="outline" size="sm" onClick={load}>{t('conversation.shared.reload', 'Reload')}</Button>
      </div>
    )}
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketDetailsContainer ticketData={ticketData} hideSlaStatus hideBilling hideScheduling hideTimeEntry hideMaterials disableAgentSchedule />
    </TicketDataSourceProvider>
  </div>;
}
