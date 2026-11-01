'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { composeTicketDataSource } from '@alga-psa/tickets/lib/ticketDataSource';
import type { CoManagedSharedResource, CoManagedSharedWorkSummary } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { saveSharedTicketEditAction } from '@/lib/actions/coManagedTicketEditActions';
import { createCoManagedSharedTicketDataSource } from '@/lib/co-managed/sharedTicketDataSource';
import { conversationAuthorMaps } from '@/lib/co-managed/sharedConversationMapping';
import type { SharedTicketDetailsResult } from '@/lib/co-managed/sharedTicketDataTypes';
import CoManagedTicketSection from './CoManagedTicketSection';
import { newCoManagedOperationId } from './coManagedOperationId';
import { createSharedConversationSession } from './sharedConversationSession';

/** The summary shape the data source is bound to, rebuilt from the already admitted details (no second read). */
function summaryFromDetails(details: SharedTicketDetailsResult): CoManagedSharedWorkSummary {
  const { ticket, options } = details.ticketData;
  const named = (id: string | undefined, list: Array<{ value: string; label: string }>) =>
    id ? { id, name: list.find(option => option.value === id)?.label ?? null } : undefined;
  const fields: Record<string, unknown> = {};
  for (const key of ['ticket_number', 'title', 'is_closed', 'entered_at', 'updated_at', 'closed_at'] as const) {
    if (key in ticket) fields[key] = ticket[key];
  }
  const board = named(ticket.board_id, options.board), status = named(ticket.status_id, options.status), priority = named(ticket.priority_id, options.priority);
  if (board) fields.board = board;
  if (status) fields.status = { ...status, name: ticket.status_name ?? status.name };
  if (priority) fields.priority = { ...priority, name: ticket.priority_name ?? priority.name };
  return { resource: details.resource, revision: details.screen.revision, fields } as unknown as CoManagedSharedWorkSummary;
}

/**
 * The native ticket screen (Grid and Entry) for a ticket shared with this MSP, composed through
 * the L3a ticket data-source seam. Nothing in `TicketDetails` is forked or branched: the shared
 * data source supplies the record, the conversation and the allowed field edits, everything it
 * does not back is absent or refuses (a foreign ticket id never reaches a native action), and the
 * co-managed section arrives through the `appSection` slot.
 */
// LEVERAGE: pattern shared-ticket-screen-composition — CoManagedSharedTicket (customer-tickets route) and this screen both mount TicketDetailsContainer over the shared data source; one should delegate to the other once the old route is a redirect.
export default function SharedTicketScreen({ resource, initialDetails, backHref }: {
  resource: CoManagedSharedResource; initialDetails: SharedTicketDetailsResult | null; backHref: string;
}) {
  const { t } = useTranslation('features/tickets');
  const tRef = useRef(t);
  tRef.current = t;
  const session = useMemo(() => createSharedConversationSession(resource, { t: (key, fallback) => tRef.current(key, { defaultValue: fallback }) }), [resource]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const load = useCallback(() => {
    setState('loading');
    session.load().then(() => setState('ready'), () => setState('failed'));
  }, [session]);
  useEffect(() => { if (initialDetails) load(); }, [initialDetails, load]);

  const dataSource = useMemo(() => {
    if (!initialDetails) return null;
    const base = createCoManagedSharedTicketDataSource(summaryFromDetails(initialDetails), backHref, {
      conversation: state === 'ready' ? session : undefined,
      edit: initialDetails.editor.editableFields.length ? {
        editableFields: initialDetails.editor.editableFields,
        baselines: { ...initialDetails.editor.baselines },
        save: request => saveSharedTicketEditAction(resource, request),
        newOperationId: newCoManagedOperationId,
      } : undefined,
    });
    return composeTicketDataSource(base, {
      slots: {
        appSection: ({ layout, refresh }) => <CoManagedTicketSection target={{ kind: 'shared', resource }} layout={layout} onChanged={refresh} />,
      },
    });
  }, [initialDetails, backHref, session, state, resource]);

  const ticketData = useMemo(() => {
    if (!initialDetails) return null;
    const snapshot = state === 'ready' ? session.snapshot() : null;
    const maps = snapshot ? conversationAuthorMaps(snapshot.items, snapshot.actor) : { userMap: {}, contactMap: {} };
    return { ...initialDetails.ticketData, comments: session.comments(), userMap: maps.userMap, contactMap: maps.contactMap };
  }, [initialDetails, session, state]);

  if (!initialDetails || !dataSource || !ticketData) {
    return <div id="co-managed-shared-ticket-unavailable" role="alert" className="p-6 text-sm">
      <p>{t('conversation.shared.unavailable', 'This ticket is not available.')}</p>
      <Link id="co-managed-shared-ticket-back" href={backHref} className="text-primary underline">{t('conversation.shared.back', 'Back to Customer Tickets')}</Link>
    </div>;
  }
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
      <TicketDetailsContainer ticketData={ticketData as never} hideSlaStatus hideBilling hideScheduling hideTimeEntry hideMaterials disableAgentSchedule />
    </TicketDataSourceProvider>
  </div>;
}
