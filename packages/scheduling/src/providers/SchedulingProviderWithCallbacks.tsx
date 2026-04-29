'use client';

import React, { useMemo } from 'react';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';
import type { SchedulingCallbacks } from '@alga-psa/ui/context';
import AgentScheduleView from '../components/schedule/AgentScheduleView';
import { launchTimeEntryForWorkItem } from '../lib/timeEntryLauncher';

interface SchedulingProviderWithCallbacksProps {
  children: React.ReactNode;
}

export const SchedulingProviderWithCallbacks: React.FC<SchedulingProviderWithCallbacksProps> = ({ children }) => {
  const callbacks = useMemo<SchedulingCallbacks>(() => ({
    renderAgentSchedule: (agentId: string) => <AgentScheduleView agentId={agentId} />,
    launchTimeEntry: (params) => launchTimeEntryForWorkItem(params),
  }), []);

  return (
    <SchedulingCallbackProvider value={callbacks}>
      {children}
    </SchedulingCallbackProvider>
  );
};
