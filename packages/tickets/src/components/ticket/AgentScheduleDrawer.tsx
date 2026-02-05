'use client';

import React from 'react';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';

interface AgentScheduleDrawerProps {
  agentId: string;
}

export default function AgentScheduleDrawer({ agentId }: AgentScheduleDrawerProps) {
  const { renderAgentSchedule } = useSchedulingCallbacks();

  return (
    <>{renderAgentSchedule(agentId)}</>
  );
}
