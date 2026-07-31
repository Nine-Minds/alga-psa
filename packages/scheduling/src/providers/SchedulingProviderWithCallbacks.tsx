'use client';

import React, { useMemo } from 'react';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';
import type { SchedulingCallbacks } from '@alga-psa/ui/context';
import AgentScheduleView from '../components/schedule/AgentScheduleView';
import { launchTimeEntryForWorkItem } from '../lib/timeEntryLauncher';
import { launchScheduleEntryForWorkItem } from '../lib/scheduleEntryLauncher';
import { fetchTimeEntriesForTicket } from '../actions/timeEntryTicketActions';
import { deleteTimeEntry } from '../actions/timeEntryActions';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface SchedulingProviderWithCallbacksProps {
  children: React.ReactNode;
}

export const SchedulingProviderWithCallbacks: React.FC<SchedulingProviderWithCallbacksProps> = ({ children }) => {
  const callbacks = useMemo<SchedulingCallbacks>(() => ({
    renderAgentSchedule: (agentId: string) => <AgentScheduleView agentId={agentId} />,
    launchTimeEntry: (params) => launchTimeEntryForWorkItem(params),
    launchScheduleEntry: (params) => launchScheduleEntryForWorkItem(params),
    fetchTimeEntriesForTicket: async (ticketId) => {
      const result = await fetchTimeEntriesForTicket(ticketId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw new Error(getErrorMessage(result));
      }
      return result;
    },
    deleteTimeEntry: (entryId) => deleteTimeEntry(entryId),
  }), []);

  return (
    <SchedulingCallbackProvider value={callbacks}>
      {children}
    </SchedulingCallbackProvider>
  );
};
