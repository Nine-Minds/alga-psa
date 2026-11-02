'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import type { CoManagedSharedWorkSummary } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createCoManagedSharedTicketDataSource, sharedTicketOptions, sharedTicketRecord } from '@/lib/co-managed/sharedTicketDataSource';
import { conversationAuthorMaps } from '@/lib/co-managed/sharedConversationMapping';
import CoManagedTicketSlaStatus from './CoManagedTicketSlaStatus';
import { useCapability } from '@alga-psa/ui/hooks';
import { useCoManagedSharedTimeConfig } from './useCoManagedSharedTimeConfig';
import { CoManagedEffortSummary } from './CoManagedEffortSummary';
import CoManagedTimeEntry from './CoManagedTimeEntry';
import { createSharedConversationSession } from './sharedConversationSession';
import QuickInvoiceTicketDialog from '@alga-psa/billing/components/ticket/QuickInvoiceTicketDialog';

/**
 * `slots.timeSummary` for the MSP's shared ticket. It owns the "time was saved" counter, so an MSP save reloads the effort split
 * ("Your team") without a page reload and without rebuilding the ticket data source.
 */
export function SharedTimeSummary({ resource, ticket, refreshKey }: {
  resource: CoManagedSharedWorkSummary['resource'];
  ticket: { ticket_id: string; ticket_number?: string; title: string };
  refreshKey?: number;
}) {
  const [savedCount, setSavedCount] = useState(0);
  const onSaved = useCallback(() => setSavedCount(count => count + 1), []);
  return <>
    <CoManagedTimeEntry resource={resource} canWrite onSaved={onSaved} />
    <CoManagedEffortSummary target={{ kind: 'shared', resource }} refreshKey={(refreshKey ?? 0) + savedCount} billingProfile />
    {/* Quick Invoice (L6a2 fix 4): mounted here, not via renderQuickInvoice, because the screen keeps `hideBilling`
        and TicketDetails gates renderQuickInvoice on billing. The server path bills only approved commercial co_managed minutes. */}
    <QuickInvoiceTicketDialog ticket={ticket} id="co-managed-shared-ticket" />
  </>;
}

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
  const { enabled: timeEnabled } = useCapability('co-managed');
  const ticketForInvoice = useMemo(() => { const record = sharedTicketRecord(summary); return { ticket_id: record.ticket_id, ticket_number: record.ticket_number, title: record.title }; }, [summary]);
  const timeConfig = useCoManagedSharedTimeConfig(summary.resource, timeEnabled);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const load = useCallback(() => {
    setState('loading');
    session.load().then(() => setState('ready'), () => setState('failed'));
  }, [session]);
  useEffect(() => { load(); }, [load]);

  // Until the conversation is admitted (or when it cannot be loaded) the screen stays fully read-only.
  const dataSource = useMemo(
    () => createCoManagedSharedTicketDataSource(summary, backHref, {
      conversation: state === 'ready' ? session : undefined,
      // Time hunk (L6a2): only a workspace that serves co-managed gets the time work item and the effort split.
      time: timeEnabled ? { config: timeConfig, slots: { timeSummary: ({ timeEntriesRefreshKey }) =>
        <SharedTimeSummary resource={summary.resource} ticket={ticketForInvoice} refreshKey={timeEntriesRefreshKey} /> } } : undefined,
    }),
    [summary, backHref, session, state, timeEnabled, timeConfig],
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
    <CoManagedTicketSlaStatus resource={summary.resource} />
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketDetailsContainer ticketData={ticketData} hideSlaStatus hideBilling hideScheduling hideTimeEntry={!timeEnabled} hideMaterials disableAgentSchedule />
    </TicketDataSourceProvider>
  </div>;
}
