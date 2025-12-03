'use client';

import React, { useState, useEffect, useRef } from 'react';
import { IWorkflowExecution } from '@alga-psa/shared/workflow/persistence';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { getWorkflowExecutionsWithDetails } from 'server/src/lib/actions/workflow-actions';
import { Button } from 'server/src/components/ui/Button';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { MoreVertical, Filter, RefreshCw } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import {
  pauseWorkflowExecutionAction,
  resumeWorkflowExecutionAction,
  cancelWorkflowExecutionAction 
} from 'server/src/lib/actions/workflow-actions';

interface WorkflowExecutionsTableProps {
  initialData?: IWorkflowExecution[];
  onRowClick?: (row: IWorkflowExecution) => void;
  customizeColumns?: (defaultColumns: ColumnDefinition<IWorkflowExecution>[]) => ColumnDefinition<IWorkflowExecution>[];
}

export default function WorkflowExecutionsTable({
  initialData = [],
  onRowClick,
  customizeColumns
}: WorkflowExecutionsTableProps) {
  const [data, setData] = useState<IWorkflowExecution[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState({
    workflowName: '',
    status: '',
  });
  const router = useRouter();
  const intervalRef = useRef<NodeJS.Timeout>();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const columns: ColumnDefinition<IWorkflowExecution>[] = [
    {
      title: 'Workflow Name',
      dataIndex: 'workflow_name',
      render: (value: string, record: IWorkflowExecution) => (
        <span 
          className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/msp/workflows/${record.execution_id}`);
          }}
        >
          {value}
        </span>
      ),
    },
    {
      title: 'Test',
      dataIndex: 'execution_id',
      width: '60px',
      render: (executionId: string) => (
        <Button
          id="test-workflow-button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/msp/workflows/${executionId}/test`);
          }}
          title="Test Workflow"
        >
          <span className="sr-only">Test workflow</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-play-circle"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        </Button>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: string) => (
        <span className={`font-medium px-2 py-1 rounded ${
          status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
          status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' :
          status === 'active' ? 'bg-[rgb(var(--color-info-50))] text-[rgb(var(--color-info-600))]' :
          status === 'paused' ? 'bg-[rgb(var(--color-warning-50))] text-[rgb(var(--color-warning-600))]' :
          'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
        }`}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      ),
    },
    {
      title: 'Current State',
      dataIndex: 'current_state',
      render: (value: string) => value,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (value?: string) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      render: (value?: string) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      title: 'Actions',
      dataIndex: 'execution_id',
      render: (executionId: string, record: IWorkflowExecution) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="workflow-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="view-workflow-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/msp/workflows/${executionId}`);
              }}
            >
              View Details
            </DropdownMenuItem>
            
            {record.status === 'active' && (
              <DropdownMenuItem
                id="pause-workflow-menu-item"
                onClick={async (e) => {
                  e.stopPropagation();
                  await pauseWorkflowExecutionAction(executionId);
                  fetchData();
                }}
              >
                Pause
              </DropdownMenuItem>
            )}
            
            {record.status === 'paused' && (
              <DropdownMenuItem
                id="resume-workflow-menu-item"
                onClick={async (e) => {
                  e.stopPropagation();
                  await resumeWorkflowExecutionAction(executionId);
                  fetchData();
                }}
              >
                Resume
              </DropdownMenuItem>
            )}
            
            {(record.status === 'active' || record.status === 'paused') && (
              <DropdownMenuItem
                id="cancel-workflow-menu-item"
                className="text-red-600 focus:text-red-600"
                onClick={async (e) => {
                  e.stopPropagation();
                  await cancelWorkflowExecutionAction(executionId);
                  fetchData();
                }}
              >
                Cancel
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const hasActiveWorkflows = (workflows: IWorkflowExecution[]) => {
    return workflows.some(workflow => workflow.status === 'active');
  };

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const newData = await getWorkflowExecutionsWithDetails({
        workflowName: filter.workflowName || undefined,
        status: filter.status || undefined,
        limit: 50,
      });
      setData(newData);
      
      // Stop polling if there are no active workflows
      if (!hasActiveWorkflows(newData)) {
        clearInterval(intervalRef.current);
      }
    } catch (error) {
      console.error('Error fetching workflow data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch data when component mounts
  useEffect(() => {
    fetchData();
  }, []);

  // Set up polling for active workflows
  useEffect(() => {
    if (hasActiveWorkflows(data)) {
      intervalRef.current = setInterval(fetchData, 5000);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [data]);

  // Use the provided onRowClick handler if available, otherwise use the default
  const handleRowClick = (row: IWorkflowExecution) => {
    if (onRowClick) {
      onRowClick(row);
    } else {
      router.push(`/msp/workflows/${row.execution_id}`);
    }
  };

  // Use customized columns if provided
  const finalColumns = customizeColumns ? customizeColumns(columns) : columns;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">
          Recent Workflow Executions
        </h3>
        <div className="flex gap-2">
          <Button
            id="refresh-workflows-button"
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
          >
            {isLoading ? (
              <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Refresh" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </>
            )}
          </Button>
          
          {/* Filter dropdown - can be expanded with more filter options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="filter-workflows-menu"
                variant="outline"
                size="sm"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id="filter-all-workflows-menu-item"
                onClick={() => {
                  setFilter({ workflowName: '', status: '' });
                  fetchData();
                }}
              >
                All Workflows
              </DropdownMenuItem>
              <DropdownMenuItem
                id="filter-active-workflows-menu-item"
                onClick={() => {
                  setFilter({ ...filter, status: 'active' });
                  fetchData();
                }}
              >
                Active Only
              </DropdownMenuItem>
              <DropdownMenuItem
                id="filter-completed-workflows-menu-item"
                onClick={() => {
                  setFilter({ ...filter, status: 'completed' });
                  fetchData();
                }}
              >
                Completed Only
              </DropdownMenuItem>
              <DropdownMenuItem
                id="filter-failed-workflows-menu-item"
                onClick={() => {
                  setFilter({ ...filter, status: 'failed' });
                  fetchData();
                }}
              >
                Failed Only
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <DataTable
        key={`${currentPage}-${pageSize}`}
        data={data}
        columns={finalColumns}
        onRowClick={handleRowClick}
        id="workflow-executions-table"
        rowClassName={() => "hover:bg-[rgb(var(--color-primary-50))] cursor-pointer"}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />
      
      {data.length === 0 && (
        <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
          No workflow executions found
        </div>
      )}
    </div>
  );
}