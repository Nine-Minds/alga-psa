'use client';

import React, { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ClientCrossFeatureProvider } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import type {
  ClientCrossFeatureCallbacks,
  QuickAddTicketRenderProps,
  TicketFormOptions,
} from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { getSlaPolicies } from '@alga-psa/sla/actions/slaActions';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';

// Lightweight cross-feature provider for the read-only client quick-view drawer
// (ClientQuickView), the only client surface the tickets list mounts. The full
// MspClientCrossFeatureProvider statically pulls the rich-text editor, billing
// contract wizard, assets, contact/client ticket lists, and scheduling actions into
// the first-load of every host page. This variant wires only the quick-view
// behavior the tickets route needs and stubs the rest, keeping the heavy
// implementations out of the host bundle through the existing render-prop layer
// (no dynamic imports). The survey summary is intentionally omitted here because
// ClientQuickView currently passes a null summary; the full client detail
// provider keeps the real survey card.
// "Add ticket" routes through the shared create-ticket route, exactly like every
// other create surface, instead of mounting the editor inline.

function QuickAddTicketRouteBridge({
  open,
  onOpenChange,
  prefilledClient,
  prefilledContact,
}: QuickAddTicketRenderProps) {
  const router = useRouter();
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      navigatedRef.current = false;
      return;
    }
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.push(
      buildCreateTicketHref({
        client: prefilledClient ? { id: prefilledClient.id, name: prefilledClient.name } : undefined,
        contact: prefilledContact ? { id: prefilledContact.id, name: prefilledContact.name } : undefined,
      }),
    );
    onOpenChange(false);
  }, [open, prefilledClient, prefilledContact, router, onOpenChange]);

  return null;
}

const noopRender = (): ReactNode => null;
const emptyTicketFormOptions = async (): Promise<TicketFormOptions> => ({
  statusOptions: [],
  priorityOptions: [],
  boardOptions: [],
  categories: [],
  tags: [],
  users: [],
});

export function MspClientQuickViewProvider({ children }: { children: ReactNode }) {
  const renderQuickAddTicket = useCallback(
    (props: QuickAddTicketRenderProps) => <QuickAddTicketRouteBridge {...props} />,
    [],
  );

  const value = useMemo<ClientCrossFeatureCallbacks>(
    () => ({
      renderQuickAddTicket,
      renderSurveySummaryCard: noopRender,
      getSlaPolicies,
      // The quick-view never invokes these — stubbed so the editor form options,
      // assets, and ticket-list implementations stay out of the host page's bundle.
      getTicketFormOptions: emptyTicketFormOptions,
      renderClientAssets: noopRender,
      renderClientTickets: noopRender,
      renderContactTickets: noopRender,
    }),
    [renderQuickAddTicket],
  );

  return <ClientCrossFeatureProvider value={value}>{children}</ClientCrossFeatureProvider>;
}
