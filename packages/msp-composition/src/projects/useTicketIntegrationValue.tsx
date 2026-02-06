'use client';

import React, { useCallback, useMemo } from 'react';
import type { TicketIntegrationContextType } from '@alga-psa/projects/context/TicketIntegrationContext';
import { getTicketsForList } from '@alga-psa/tickets/actions/ticketActions';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getTicketCategories, getAllBoards } from '@alga-psa/tickets/actions';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import { PrioritySelect } from '@alga-psa/tickets/components/PrioritySelect';
import { getCurrentUser } from '@alga-psa/users/actions';
import { useDrawer } from '@alga-psa/ui';
import { toast } from 'react-hot-toast';

export function useTicketIntegrationValue(): TicketIntegrationContextType {
  const { openDrawer } = useDrawer();

  const openTicketInDrawer = useCallback(async (ticketId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('No user session found');
        return;
      }
      const ticketData = await getConsolidatedTicketData(ticketId);
      if (!ticketData) {
        toast.error('Failed to load ticket');
        return;
      }
      openDrawer(
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
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          boardOptions={ticketData.options.board}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
          initialClients={ticketData.clients}
          initialLocations={ticketData.locations}
          initialAgentSchedules={ticketData.agentSchedules}
          initialUserMap={ticketData.userMap}
          initialAvailableAgents={ticketData.availableAgents}
          currentUser={user}
        />
      );
    } catch (error) {
      console.error('Error loading ticket:', error);
      toast.error('Failed to load ticket');
    }
  }, [openDrawer]);

  const renderQuickAddTicket = useCallback(
    (renderProps: Parameters<TicketIntegrationContextType['renderQuickAddTicket']>[0]) => (
      <div className="relative z-[80]">
        <QuickAddTicket
          id="quick-add-ticket"
          open={renderProps.open}
          onOpenChange={renderProps.onOpenChange}
          onTicketAdded={renderProps.onTicketAdded}
          prefilledClient={renderProps.prefilledClient}
          prefilledTitle={renderProps.prefilledTitle}
          prefilledDescription={renderProps.prefilledDescription}
          prefilledAssignedTo={renderProps.prefilledAssignedTo}
          prefilledDueDate={renderProps.prefilledDueDate}
          prefilledAdditionalAgents={renderProps.prefilledAdditionalAgents}
          isEmbedded={renderProps.isEmbedded}
          renderBeforeFooter={renderProps.renderBeforeFooter}
        />
      </div>
    ),
    []
  );

  const renderCategoryPicker = useCallback(
    (renderProps: Parameters<TicketIntegrationContextType['renderCategoryPicker']>[0]) => (
      <CategoryPicker
        id={renderProps.id}
        categories={renderProps.categories}
        selectedCategories={renderProps.selectedCategories}
        onSelect={renderProps.onSelect}
        placeholder={renderProps.placeholder}
        multiSelect={renderProps.multiSelect}
      />
    ),
    []
  );

  const renderPrioritySelect = useCallback(
    (renderProps: Parameters<TicketIntegrationContextType['renderPrioritySelect']>[0]) => (
      <PrioritySelect
        value={renderProps.value}
        options={renderProps.options}
        onValueChange={renderProps.onValueChange}
        placeholder={renderProps.placeholder}
        className={renderProps.className}
      />
    ),
    []
  );

  return useMemo<TicketIntegrationContextType>(
    () => ({
      getTicketsForList,
      getConsolidatedTicketData,
      getTicketCategories,
      getAllBoards,
      openTicketInDrawer,
      renderQuickAddTicket,
      renderCategoryPicker,
      renderPrioritySelect,
    }),
    [openTicketInDrawer, renderQuickAddTicket, renderCategoryPicker, renderPrioritySelect]
  );
}
