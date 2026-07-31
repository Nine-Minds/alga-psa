'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import type { ITicket } from '@alga-psa/types';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import {
  type CreateTicketCloseMode,
  type CreateTicketPrefill,
} from '@alga-psa/tickets/lib/createTicketRoute';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CreateTicketRouteClientProps {
  closeMode: CreateTicketCloseMode;
  prefill: CreateTicketPrefill;
}

export default function CreateTicketRouteClient({ closeMode, prefill }: CreateTicketRouteClientProps) {
  const router = useRouter();
  const { t } = useTranslation('msp/core');
  // QuickAddTicket fires BOTH onTicketAdded and onOpenChange(false) on a successful create,
  // so close() can be called twice. Guard it so we navigate exactly once — otherwise a
  // double router.back() pops two history entries (e.g. tickets list AND the page before it).
  const closedRef = useRef(false);

  // 'back' closes an intercepted modal (returns to the page it overlays); 'replace' is the
  // hard-loaded full route, which has no overlay to pop, so land on the tickets list.
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (closeMode === 'back') {
      router.back();
      return;
    }
    router.replace('/msp/tickets');
  };

  const handleTicketAdded = (ticket: ITicket) => {
    toast.success(
      t('quickCreate.success.ticket', {
        defaultValue: 'Ticket #{{number}} created successfully',
        number: ticket.ticket_number,
      }),
    );
    // Refresh the route tree so any SSR-driven list under the modal re-fetches.
    router.refresh();
    // Client-side ticket lists (e.g. a client's/contact's tickets tab) don't react to
    // router.refresh(); notify them. Event name mirrored in those list components.
    window.dispatchEvent(new CustomEvent('alga:quick-create:created', { detail: { entity: 'ticket' } }));
    close();
  };

  // "Create + View Ticket": navigate straight to the new ticket in a SINGLE step. We must NOT
  // also run handleTicketAdded's close (router.back) — a back() racing this navigation is the
  // bug that aborted one or the other (stranding the user on the list, or leaving the dialog
  // stuck over the detail page). router.replace swaps the intercept URL (/msp/create-ticket)
  // for the ticket detail, which both dismisses this modal route and lands on the ticket.
  const handleViewCreatedTicket = (ticket: ITicket) => {
    if (closedRef.current) return;
    closedRef.current = true;
    toast.success(
      t('quickCreate.success.ticket', {
        defaultValue: 'Ticket #{{number}} created successfully',
        number: ticket.ticket_number,
      }),
    );
    router.replace(`/msp/tickets/${ticket.ticket_id}`);
  };

  return (
    <QuickAddTicket
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onTicketAdded={handleTicketAdded}
      onViewCreatedTicket={handleViewCreatedTicket}
      prefilledClient={prefill.client}
      prefilledContact={prefill.contact}
      prefilledDescription={prefill.description}
      prefilledTitle={prefill.title}
      prefilledAssignedTo={prefill.assignedTo}
      prefilledDueDate={prefill.dueDate ?? null}
      prefilledAdditionalAgents={prefill.additionalAgents}
      assetId={prefill.assetId}
      assetName={prefill.assetName}
      isAlgaDeskMode={prefill.isAlgaDeskMode}
    />
  );
}
