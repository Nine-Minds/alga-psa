'use client';

import React from 'react';
import { useSchedulingCallbacks, type WorkItemScheduleContext } from '@alga-psa/ui/context';

interface AgentScheduleDrawerProps {
  agentId: string;
  workItemContext?: WorkItemScheduleContext;
}

export default function AgentScheduleDrawer({ agentId, workItemContext }: AgentScheduleDrawerProps) {
  const { renderAgentSchedule } = useSchedulingCallbacks();

  return (
    <>{renderAgentSchedule(agentId, workItemContext)}</>
  );
}
