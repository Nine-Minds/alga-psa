"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import WorkflowExecutionsTable from '../WorkflowExecutionsTable';
import { IWorkflowExecution } from '@alga-psa/shared/workflow/persistence';
import { ColumnDefinition } from '@alga-psa/types';

export default function LogsHistoryWorkflowTable() {
  const router = useRouter();

  // Override the default row click behavior to navigate within the Logs & History page
  const handleRowClick = (row: IWorkflowExecution) => {
    router.push(`/msp/automation-hub?tab=logs-history&executionId=${row.execution_id}`);
  };

  // Create a custom wrapper around WorkflowExecutionsTable to override its behavior
  const CustomWorkflowExecutionsTable = () => {
    // Create a custom version of the columns to override the workflow name click behavior
    const customizeColumns = (defaultColumns: ColumnDefinition<IWorkflowExecution>[]) => {
      // First filter out the Test column
      return defaultColumns
        .filter(column => column.title !== 'Test') // Remove the Test column
        .map(column => {
          if (column.dataIndex === 'workflow_name') {
            return {
              ...column,
              render: (value: string, record: IWorkflowExecution) => (
                <span 
                  className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/msp/automation-hub?tab=logs-history&executionId=${record.execution_id}`);
                  }}
                >
                  {value}
                </span>
              )
            };
          }
          return column;
        });
    };

    return (
      <WorkflowExecutionsTable 
        initialData={[]}
        onRowClick={handleRowClick}
        customizeColumns={customizeColumns}
      />
    );
  };

  return (
    <div className="workflow-executions-wrapper">
      <CustomWorkflowExecutionsTable />
    </div>
  );
}
