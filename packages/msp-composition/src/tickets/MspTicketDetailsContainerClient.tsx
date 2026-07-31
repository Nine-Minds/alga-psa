'use client';

import React, { useCallback } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import type { IClient, IContact, ITicketLinkedTask, SurveyTicketSatisfactionSummary } from '@alga-psa/types';
import CreateTaskFromTicketDialog from '@alga-psa/projects/components/CreateTaskFromTicketDialog';
import LinkTicketToTaskDialog from '@alga-psa/projects/components/LinkTicketToTaskDialog';
import TicketLinkedTasksBadge from '@alga-psa/projects/components/TicketLinkedTasksBadge';
import { IntervalManagement } from '@alga-psa/scheduling/components/time-management/interval-tracking/IntervalManagement';
import { TicketIntegrationProvider } from '@alga-psa/projects/context/TicketIntegrationContext';
import { useTicketIntegrationValue } from '../projects/useTicketIntegrationValue';
import TicketSurveySummaryCard from '@alga-psa/surveys/components/TicketSurveySummaryCard';
import { MspClientCrossFeatureProvider } from '../clients/MspClientCrossFeatureProvider';
import {
  deleteDraftClipboardImages,
  uploadTicketAttachmentDocument
} from './composedClipboardActions';
import { resolveTicketAttachmentViewUrl } from './ticketAttachmentViewUrl';

type MspTicketDetailsContainerClientProps = Omit<
  React.ComponentProps<typeof TicketDetailsContainer>,
  'renderContactDetails' | 'renderClientDetails' | 'renderIntervalManagement' | 'surveySummaryCard'
> & {
  surveySummary?: SurveyTicketSatisfactionSummary | null;
  isAlgaDeskMode?: boolean;
  /** Server-started linked-tasks promise for the TicketLinkedTasksBadge. */
  linkedTasksStream?: Promise<ITicketLinkedTask[] | { actionError: string } | { permissionError: string }>;
};

export default function MspTicketDetailsContainerClient({
  surveySummary,
  isAlgaDeskMode = false,
  linkedTasksStream,
  ...props
}: MspTicketDetailsContainerClientProps) {
  const ticketIntegrationValue = useTicketIntegrationValue();

  const renderContactDetails = useCallback(
    ({ id, contact, clients, userId }: { id: string; contact: IContact; clients: IClient[]; userId?: string }) => {
      return (
        <ContactDetailsView
          id={id}
          initialContact={contact}
          clients={clients}
          isInDrawer={true}
          userId={userId}
          quickView={true}
          showDocuments={false}
          showInteractions={true}
          clientReadOnly={true}
        />
      );
    },
    []
  );

  const renderCreateProjectTask = useCallback(
    ({ ticket, additionalAgents }: { ticket: any; additionalAgents?: { user_id: string; name: string }[] }) => (
      <>
        {ticket.ticket_id && (
          <TicketLinkedTasksBadge ticketId={ticket.ticket_id} initialTasks={linkedTasksStream} />
        )}
        <CreateTaskFromTicketDialog ticket={{ ...ticket, additional_agents: additionalAgents }} />
        <LinkTicketToTaskDialog ticket={ticket} />
      </>
    ),
    [linkedTasksStream]
  );

  const renderClientDetails = useCallback(
    ({ id, client }: { id: string; client: IClient }) => {
      return (
        <MspClientCrossFeatureProvider>
          <ClientQuickView id={id} client={client} isInDrawer={true} quickView={true} />
        </MspClientCrossFeatureProvider>
      );
    },
    []
  );

  const renderIntervalManagement = useCallback(
    ({ ticketId, userId }: { ticketId: string; userId: string }) => (
      <IntervalManagement ticketId={ticketId} userId={userId} />
    ),
    []
  );

  return (
    <TicketIntegrationProvider value={ticketIntegrationValue}>
      <TicketDetailsContainer
        {...props}
        surveySummaryCard={
          !isAlgaDeskMode && surveySummary !== undefined
            ? <TicketSurveySummaryCard summary={surveySummary} />
            : undefined
        }
        renderContactDetails={renderContactDetails}
        renderCreateProjectTask={isAlgaDeskMode ? undefined : renderCreateProjectTask}
        renderClientDetails={renderClientDetails}
        renderIntervalManagement={isAlgaDeskMode ? undefined : renderIntervalManagement}
        hideSlaStatus={isAlgaDeskMode}
        hideBilling={isAlgaDeskMode}
        hideScheduling={isAlgaDeskMode}
        hideTimeEntry={isAlgaDeskMode}
        hideMaterials={isAlgaDeskMode}
        uploadTicketAttachmentAction={uploadTicketAttachmentDocument}
        deleteDraftTicketAttachmentImagesAction={deleteDraftClipboardImages}
        resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
        disableAttachmentFolderSelection={isAlgaDeskMode}
        disableAttachmentSharing={isAlgaDeskMode}
        disableAttachmentLinking={isAlgaDeskMode}
        disableAgentSchedule={isAlgaDeskMode}
      />
    </TicketIntegrationProvider>
  );
}
