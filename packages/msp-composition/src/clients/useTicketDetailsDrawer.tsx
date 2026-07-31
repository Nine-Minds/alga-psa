'use client';

import React, { useCallback } from 'react';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions/userQueryActions';

/**
 * Open a ticket in the shared drawer, keeping the current page underneath.
 * Same flow as MspClientTickets' row click, packaged for the client
 * cross-feature providers (command center ticket links, timeline events).
 */
export function useTicketDetailsDrawer(): (ticketId: string) => Promise<void> {
  const { openDrawer, replaceDrawer } = useDrawer();
  const { t } = useTranslation('msp/clients');

  return useCallback(async (ticketId: string) => {
    openDrawer(
      <div className="p-4 text-sm text-gray-600">
        {t('clientTabs.tickets.loading', { defaultValue: 'Loading tickets...' })}
      </div>
    );
    try {
      const [ticketData, currentUser] = await Promise.all([
        getConsolidatedTicketData(ticketId),
        getCurrentUser(),
      ]);

      if (!ticketData || !currentUser) {
        replaceDrawer(
          <div className="p-4 text-sm text-gray-600">
            {t('clientTabs.tickets.toasts.loadTicketFailed', { defaultValue: 'Failed to load ticket' })}
          </div>
        );
        return;
      }

      replaceDrawer(
        <TicketDetails
          isInDrawer={true}
          initialTicket={ticketData.ticket}
          initialComments={ticketData.comments}
          initialBoard={ticketData.board}
          initialClient={ticketData.client}
          initialContacts={ticketData.contacts}
          initialContactInfo={ticketData.contactInfo}
          initialCreatedByUser={ticketData.createdByUser}
          initialAdditionalAgents={ticketData.additionalAgents}
          initialAvailableAgents={ticketData.availableAgents}
          initialUserMap={ticketData.userMap}
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          boardOptions={ticketData.options.board}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
          initialClients={ticketData.clients}
          initialLocations={ticketData.locations}
          currentUser={currentUser}
        />
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('clientTabs.tickets.toasts.loadTicketFailed', { defaultValue: 'Failed to load ticket' });
      replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
    }
  }, [openDrawer, replaceDrawer, t]);
}
