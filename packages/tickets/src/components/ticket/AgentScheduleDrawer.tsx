'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

interface AgentScheduleDrawerProps {
  agentId: string;
}

export default function AgentScheduleDrawer({ agentId }: AgentScheduleDrawerProps) {
  return (
    <div className="p-4">
      <Alert>
        <AlertDescription>
          Agent schedule view is now owned by Scheduling. (agentId: {agentId})
        </AlertDescription>
      </Alert>
    </div>
  );
}

