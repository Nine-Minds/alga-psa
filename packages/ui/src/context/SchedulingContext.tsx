'use client';

import React, { createContext, useContext } from 'react';
import { Alert, AlertDescription } from '../components/Alert';
import { toast } from 'react-hot-toast';
import type {
  TimeEntryWorkItemContext,
  TicketTimeEntriesSummary,
} from '@alga-psa/types';

export type OpenDrawerFn = (
  content: React.ReactNode,
  onMount?: () => Promise<void>,
  onClose?: () => void,
  width?: string
) => void;

export interface SchedulingCallbacks {
  renderAgentSchedule: (agentId: string) => React.ReactNode;
  launchTimeEntry: (params: {
    openDrawer: OpenDrawerFn;
    closeDrawer: () => void;
    context: TimeEntryWorkItemContext;
    onComplete?: () => void;
    existingEntryId?: string;
  }) => Promise<void>;
  fetchTimeEntriesForTicket: (ticketId: string) => Promise<TicketTimeEntriesSummary>;
  deleteTimeEntry: (entryId: string) => Promise<void>;
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
