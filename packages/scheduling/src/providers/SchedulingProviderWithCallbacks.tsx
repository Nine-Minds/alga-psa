'use client';

import React, { useMemo } from 'react';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';
import type { SchedulingCallbacks } from '@alga-psa/ui/context';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
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
  // The v1.5 flag is resolved here (the launcher is a plain async function, not
  // a hook host) and threaded into every launch so flag-off callers keep the
  // exact legacy toast behavior.
  const { enabled: v15Enabled } = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const callbacks = useMemo<SchedulingCallbacks>(() => ({
    renderAgentSchedule: (agentId: string) => <AgentScheduleView agentId={agentId} />,
    launchTimeEntry: (params) => launchTimeEntryForWorkItem({ ...params, enhancedLaunchFeedback: v15Enabled }),
    launchScheduleEntry: (params) => launchScheduleEntryForWorkItem(params),
    fetchTimeEntriesForTicket: async (ticketId) => {
      const result = await fetchTimeEntriesForTicket(ticketId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw new Error(getErrorMessage(result));
      }
      return result;
    },
    deleteTimeEntry: (entryId) => deleteTimeEntry(entryId),
  }), [v15Enabled]);

  return (
    <SchedulingCallbackProvider value={callbacks}>
      {children}
    </SchedulingCallbackProvider>
  );
};
