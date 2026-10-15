'use client';

import React, { createContext, useContext } from 'react';
import { Alert, AlertDescription } from '../components/Alert';
import { toast } from 'react-hot-toast';
import type {
  TimeEntryWorkItemContext,
  TicketTimeEntriesSummary,
} from '@alga-psa/types';
import type {
  ActionMessageError,
  ActionPermissionError,
} from '../lib/errorHandling';

export type OpenDrawerFn = (
  content: React.ReactNode,
  onMount?: () => Promise<void>,
  onClose?: () => void,
  width?: string
) => void;

/**
 * A work item (e.g. a ticket) that schedule entries are created or edited
 * for. Shared by every scheduling surface a ticket page can open: the
 * "schedule time" drawer, the agent calendar drawer, and existing-entry edits.
 */
export interface WorkItemScheduleContext {
  workItemId: string;
  workItemType: 'ticket';
  /** Pre-fills the entry title and the selected work item label. */
  title: string;
  clientName?: string | null;
  /**
   * Who a new entry is for when the surface has no better answer (e.g. the
   * ticket's assignee). Falls back to the current user.
   */
  defaultAssigneeId?: string | null;
  /** Called after an entry is created, updated or deleted so the host can refresh. */
  onScheduled?: () => void;
}

export interface SchedulingCallbacks {
  renderAgentSchedule: (
    agentId: string,
    workItemContext?: WorkItemScheduleContext
  ) => React.ReactNode;
  launchTimeEntry: (params: {
    openDrawer: OpenDrawerFn;
    closeDrawer: () => void;
    context: TimeEntryWorkItemContext;
    onComplete?: () => void;
    existingEntryId?: string;
  }) => Promise<void>;
  /**
   * Opens the schedule-entry editor in the global drawer, pre-scoped to the
   * given work item: a new entry by default, or `existingEntryId` to edit one.
   */
  launchScheduleEntry: (params: {
    openDrawer: OpenDrawerFn;
    closeDrawer: () => void;
    context: WorkItemScheduleContext;
    onComplete?: () => void;
    existingEntryId?: string;
  }) => Promise<void>;
  fetchTimeEntriesForTicket: (ticketId: string) => Promise<TicketTimeEntriesSummary>;
  deleteTimeEntry: (entryId: string) => Promise<void | ActionMessageError | ActionPermissionError>;
}

const defaultSchedulingCallbacks: SchedulingCallbacks = {
  renderAgentSchedule: (agentId: string) => (
    <div className="p-4">
      <Alert>
        <AlertDescription>
          Agent schedule view is now owned by Scheduling. (agentId: {agentId})
        </AlertDescription>
      </Alert>
    </div>
  ),
  launchTimeEntry: async () => {
    toast('Time entry is managed in Scheduling.');
  },
  launchScheduleEntry: async () => {
    toast('Scheduling is managed in Scheduling.');
  },
  fetchTimeEntriesForTicket: async () => ({
    entries: [],
    ownTotalMinutes: 0,
    ownEntryCount: 0,
    othersTotalMinutes: 0,
    othersEntryCount: 0,
    othersVisibleMinutes: 0,
    othersVisibleCount: 0,
    othersHiddenMinutes: 0,
    othersHiddenCount: 0,
    totalMinutes: 0,
  }),
  deleteTimeEntry: async () => {
    toast('Time entry is managed in Scheduling.');
  },
};

const SchedulingContext = createContext<SchedulingCallbacks>(defaultSchedulingCallbacks);

export const SchedulingCallbackProvider = SchedulingContext.Provider;

export function useSchedulingCallbacks(): SchedulingCallbacks {
  return useContext(SchedulingContext);
}

export { SchedulingContext };
