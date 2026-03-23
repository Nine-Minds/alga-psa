'use client';

import React, { useMemo, useCallback, useRef, type ReactNode } from 'react';
import {
  SchedulingCrossFeatureProvider,
} from '@alga-psa/scheduling/context/SchedulingCrossFeatureContext';
import type {
  SchedulingCrossFeatureCallbacks,
  SchedulingTicketDetailsRenderProps,
  SchedulingInteractionDetailsRenderProps,
  SchedulingTaskEditRenderProps,
} from '@alga-psa/scheduling/context/SchedulingCrossFeatureContext';

// Ticket imports
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';

// Client imports
import InteractionDetails from '@alga-psa/clients/components/interactions/InteractionDetails';
import { getInteractionById } from '@alga-psa/clients/actions';

// Project imports
import TaskEdit from '@alga-psa/projects/components/TaskEdit';
import { getTaskById } from '@alga-psa/projects/actions/projectTaskActions';
import { getProjectMetadata, getProjectPhase, getProjectTreeData } from '@alga-psa/projects/actions/projectActions';

export function MspSchedulingCrossFeatureProvider({ children }: { children: ReactNode }) {
  // Use refs for render callbacks to prevent context value instability
  const renderTicketDetailsRef = useRef<(props: SchedulingTicketDetailsRenderProps) => ReactNode>(null);
  const renderInteractionDetailsRef = useRef<(props: SchedulingInteractionDetailsRenderProps) => ReactNode>(null);
  const renderTaskEditRef = useRef<(props: SchedulingTaskEditRenderProps) => ReactNode>(null);

  renderTicketDetailsRef.current = (props: SchedulingTicketDetailsRenderProps) => {
    const ticketData = props.consolidatedData;
    return (
      <TicketDetails
        isInDrawer={props.isInDrawer}
        initialTicket={ticketData.ticket}
        initialBundle={ticketData.bundle}
        aggregatedChildClientComments={ticketData.aggregatedChildClientComments}
        initialComments={ticketData.comments}
        initialDocuments={ticketData.documents}
        initialBoard={ticketData.board}
        initialClient={ticketData.client}
        initialContacts={ticketData.contacts}
        initialContactInfo={ticketData.contactInfo}
        initialCreatedByUser={ticketData.createdByUser}
        initialAdditionalAgents={ticketData.additionalAgents}
        initialAvailableAgents={ticketData.availableAgents}
        initialUserMap={ticketData.userMap}
        initialContactMap={ticketData.contactMap}
        statusOptions={ticketData.options.status}
        agentOptions={ticketData.options.agent}
        boardOptions={ticketData.options.board}
        priorityOptions={ticketData.options.priority}
        initialCategories={ticketData.categories}
        initialClients={ticketData.clients}
        initialLocations={ticketData.locations}
        initialAgentSchedules={ticketData.agentSchedules}
        currentUser={props.currentUser}
      />
    );
  };

  renderInteractionDetailsRef.current = (props: SchedulingInteractionDetailsRenderProps) => (
    <InteractionDetails
      interaction={props.interaction}
      isInDrawer={props.isInDrawer}
    />
  );

  renderTaskEditRef.current = (props: SchedulingTaskEditRenderProps) => (
    <TaskEdit
      task={props.task}
      phase={props.phase}
      phases={props.phases}
      users={props.users}
      inDrawer={props.inDrawer}
      onClose={props.onClose}
      onTaskUpdated={props.onTaskUpdated}
      projectTreeData={props.projectTreeData}
    />
  );

  const renderTicketDetails = useCallback(
    (props: SchedulingTicketDetailsRenderProps) => renderTicketDetailsRef.current!(props),
    []
  );

  const renderInteractionDetails = useCallback(
    (props: SchedulingInteractionDetailsRenderProps) => renderInteractionDetailsRef.current!(props),
    []
  );

  const renderTaskEdit = useCallback(
    (props: SchedulingTaskEditRenderProps) => renderTaskEditRef.current!(props),
    []
  );

  const value = useMemo<SchedulingCrossFeatureCallbacks>(
    () => ({
      renderTicketDetails,
      renderInteractionDetails,
      renderTaskEdit,
      getConsolidatedTicketData,
      getInteractionById,
      getTaskById,
      getProjectPhase,
      getProjectMetadata,
      getProjectTreeData,
    }),
    [renderTicketDetails, renderInteractionDetails, renderTaskEdit]
  );

  return (
    <SchedulingCrossFeatureProvider value={value}>
      {children}
    </SchedulingCrossFeatureProvider>
  );
}
