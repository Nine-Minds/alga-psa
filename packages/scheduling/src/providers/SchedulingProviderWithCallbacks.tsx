'use client';

import React, { useMemo } from 'react';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';
import type { SchedulingCallbacks } from '@alga-psa/ui/context';
import AgentScheduleView from '../components/schedule/AgentScheduleView';
import { launchTimeEntryForWorkItem } from '../lib/timeEntryLauncher';
import { fetchTimeEntriesForTicket } from '../actions/timeEntryTicketActions';
import { deleteTimeEntry } from '../actions/timeEntryActions';

interface SchedulingProviderWithCallbacksProps {
  children: React.ReactNode;
}

export const SchedulingProviderWithCallbacks: React.FC<SchedulingProviderWithCallbacksProps> = ({ children }) => {
  const callbacks = useMemo<SchedulingCallbacks>(() => ({
    renderAgentSchedule: (agentId: string) => <AgentScheduleView agentId={agentId} />,
    launchTimeEntry: (params) => launchTimeEntryForWorkItem(params),
    fetchTimeEntriesForTicket: (ticketId) => fetchTimeEntriesForTicket(ticketId),
    deleteTimeEntry: (entryId) => deleteTimeEntry(entryId),
  }), []);

  return (
    <SchedulingCallbackProvider value={callbacks}>
      {children}
    </SchedulingCallbackProvider>
  );
};
