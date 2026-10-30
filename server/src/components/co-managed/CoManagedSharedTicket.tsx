'use client';

import { useMemo } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import type { CoManagedSharedWorkSummary } from '@alga-psa/co-managed';
import { createCoManagedSharedTicketDataSource, sharedTicketOptions, sharedTicketRecord } from '@/lib/co-managed/sharedTicketDataSource';

/**
 * The standard ticket screen, mounted read-only over a co-managed shared ticket.
 * The screen is not forked: an app-layer data source (see sharedTicketDataSource)
 * is injected through the provider and everything else is TicketDetails.
 */
export default function CoManagedSharedTicket({ summary, backHref }: { summary: CoManagedSharedWorkSummary; backHref: string }) {
  const dataSource = useMemo(() => createCoManagedSharedTicketDataSource(summary, backHref), [summary, backHref]);
  const ticketData = useMemo(() => ({
    ticket: sharedTicketRecord(summary), comments: [], documents: [], client: null, contacts: [], contactInfo: null,
    createdByUser: null, board: null, additionalAgents: [], availableAgents: [], userMap: {},
    options: sharedTicketOptions(summary), categories: [], clients: [], locations: [], agentSchedules: [],
  }), [summary]);
  return <div id="co-managed-shared-ticket" className="bg-[rgb(var(--color-app-ground))]">
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketDetailsContainer ticketData={ticketData} hideSlaStatus hideBilling hideScheduling hideTimeEntry hideMaterials disableAgentSchedule />
    </TicketDataSourceProvider>
  </div>;
}
