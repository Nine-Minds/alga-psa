'use client';

import React, { useMemo } from 'react';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';
import AgentScheduleView from '@alga-psa/scheduling/components/schedule/AgentScheduleView';
import { launchTimeEntryForWorkItem } from '@alga-psa/scheduling/lib/timeEntryLauncher';

interface MspSchedulingProviderProps {
  children: React.ReactNode;
}

export const MspSchedulingProvider: React.FC<MspSchedulingProviderProps> = ({ children }) => {
  const callbacks = useMemo(() => ({
    renderAgentSchedule: (agentId: string) => <AgentScheduleView agentId={agentId} />,
    launchTimeEntry: ({ openDrawer, closeDrawer, context, onComplete }) =>
      launchTimeEntryForWorkItem({ openDrawer, closeDrawer, context, onComplete }),
  }), []);

  return (
    <SchedulingCallbackProvider value={callbacks}>
      {children}
    </SchedulingCallbackProvider>
  );
};
