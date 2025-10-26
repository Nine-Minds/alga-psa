'use client';

import React, { useState } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { History } from 'lucide-react';
import LogsHistoryWorkflowTable from '@product/workflows/workflows/logs-history/LogsHistoryWorkflowTable';
import { WorkflowExecutionDetails } from '@product/workflows/workflows/logs-history/WorkflowExecutionDetails';
import { useSearchParams, useRouter } from 'next/navigation';

export default function LogsHistory() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const executionId = searchParams?.get('executionId') || null;

  const handleBack = () => {
    // Navigate back to the list view by removing the executionId query parameter
    router.push('/msp/automation-hub?tab=logs-history');
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center mb-6">
          <History className="h-6 w-6 text-primary-500 mr-2" />
          <h1 className="text-xl font-semibold">Logs & Workflow History</h1>
        </div>
        
        {executionId ? (
          <WorkflowExecutionDetails
            executionId={executionId}
            onBack={handleBack}
          />
        ) : (
          <LogsHistoryWorkflowTable />
        )}
      </Card>
    </div>
  );
}
