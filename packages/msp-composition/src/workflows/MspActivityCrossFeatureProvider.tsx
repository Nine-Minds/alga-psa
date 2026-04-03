'use client';

import React, { useMemo, useCallback, useRef, type ReactNode } from 'react';
import {
  ActivityCrossFeatureProvider,
} from '@alga-psa/ui/context';
import type {
  ActivityCrossFeatureCallbacks,
  ActivityTicketDetailsRenderProps,
  ActivityTaskEditRenderProps,
  ActivityEntryPopupRenderProps,
  ActivityTimeEntryDialogRenderProps,
} from '@alga-psa/ui/context';

// Ticket imports
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';

// Client imports
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';

// Project imports
import TaskEdit from '@alga-psa/projects/components/TaskEdit';
import { getTaskWithDetails } from '@alga-psa/projects/actions/projectTaskActions';
import { getProjects } from '@alga-psa/projects/actions/projectActions';

// Scheduling imports
import { getScheduleEntries } from '@alga-psa/scheduling/actions';
import { getTimeEntryById, saveTimeEntry } from '@alga-psa/scheduling/actions/timeEntryActions';
import EntryPopup from '@alga-psa/scheduling/components/schedule/EntryPopup';
import TimeEntryDialog from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryDialog';

// Document imports
import { getBlockContent, updateBlockContent } from '@alga-psa/documents/actions/documentBlockContentActions';

export function MspActivityCrossFeatureProvider({ children }: { children: ReactNode }) {
  const renderTicketDetailsRef = useRef<(props: ActivityTicketDetailsRenderProps) => ReactNode>(null);
  const renderTaskEditRef = useRef<(props: ActivityTaskEditRenderProps) => ReactNode>(null);
  const renderEntryPopupRef = useRef<(props: ActivityEntryPopupRenderProps) => ReactNode>(null);
  const renderTimeEntryDialogRef = useRef<(props: ActivityTimeEntryDialogRenderProps) => ReactNode>(null);

  renderTicketDetailsRef.current = (props: ActivityTicketDetailsRenderProps) => {
    const d = props.consolidatedData;
    return (
      <TicketDetails
        isInDrawer={props.isInDrawer}
        initialTicket={d.ticket}
        initialComments={d.comments}
        initialBoard={d.board}
        initialClient={d.client}
        initialContacts={d.contacts}
        initialContactInfo={d.contactInfo}
        initialCreatedByUser={d.createdByUser}
        initialAdditionalAgents={d.additionalAgents}
        statusOptions={d.options.status}
        agentOptions={d.options.agent}
        boardOptions={d.options.board}
        priorityOptions={d.options.priority}
        initialCategories={d.categories}
        initialClients={d.clients}
        initialLocations={d.locations}
        initialAgentSchedules={d.agentSchedules}
        currentUser={props.currentUser}
        initialUserMap={d.userMap}
        initialAvailableAgents={d.availableAgents}
        onClose={props.onClose}
      />
    );
  };

  renderTaskEditRef.current = (props: ActivityTaskEditRenderProps) => (
    <TaskEdit
      inDrawer={props.inDrawer}
      users={props.users}
      phase={props.phase}
      task={props.task}
      onClose={props.onClose}
      onTaskUpdated={props.onTaskUpdated}
    />
  );

  renderEntryPopupRef.current = (props: ActivityEntryPopupRenderProps) => (
    <EntryPopup
      canAssignMultipleAgents={props.canAssignMultipleAgents}
      users={props.users}
      currentUserId={props.currentUserId}
      event={props.event}
      onClose={props.onClose}
      onSave={props.onSave}
      isInDrawer={props.isInDrawer}
      canModifySchedule={props.canModifySchedule}
      focusedTechnicianId={props.focusedTechnicianId}
      canAssignOthers={props.canAssignOthers}
    />
  );

  renderTimeEntryDialogRef.current = (props: ActivityTimeEntryDialogRenderProps) => (
    <TimeEntryDialog
      id={props.id}
      isOpen={props.isOpen}
      onClose={props.onClose}
      onSave={props.onSave}
      workItem={props.workItem}
      date={props.date}
      existingEntries={props.existingEntries}
      timePeriod={props.timePeriod}
      isEditable={props.isEditable}
      inDrawer={props.inDrawer}
      timeSheetId={props.timeSheetId}
    />
  );

  const renderTicketDetails = useCallback(
    (props: ActivityTicketDetailsRenderProps) => renderTicketDetailsRef.current!(props),
    []
  );
  const renderTaskEdit = useCallback(
    (props: ActivityTaskEditRenderProps) => renderTaskEditRef.current!(props),
    []
  );
  const renderEntryPopup = useCallback(
    (props: ActivityEntryPopupRenderProps) => renderEntryPopupRef.current!(props),
    []
  );
  const renderTimeEntryDialog = useCallback(
    (props: ActivityTimeEntryDialogRenderProps) => renderTimeEntryDialogRef.current!(props),
    []
  );

  const value = useMemo<ActivityCrossFeatureCallbacks>(
    () => ({
      renderTicketDetails,
      renderTaskEdit,
      renderEntryPopup,
      renderTimeEntryDialog,
      getConsolidatedTicketData,
      getTaskWithDetails,
      getScheduleEntries,
      getTimeEntryById,
      saveTimeEntry,
      getBlockContent,
      updateBlockContent,
      getProjects,
      getAllClients,
      getAllContacts,
    }),
    [renderTicketDetails, renderTaskEdit, renderEntryPopup, renderTimeEntryDialog]
  );

  return (
    <ActivityCrossFeatureProvider value={value}>
      {children}
    </ActivityCrossFeatureProvider>
  );
}
