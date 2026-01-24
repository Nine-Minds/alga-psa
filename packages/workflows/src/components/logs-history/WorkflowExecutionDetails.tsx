"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Button } from '@alga-psa/ui/components/Button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { IWorkflowExecution } from '@alga-psa/shared/workflow/persistence';
import { getWorkflowExecutionDetails } from '../../actions/workflow-actions';
import WorkflowEventTimeline from '../WorkflowEventTimeline';
import WorkflowActionsList from '../WorkflowActionsList';
import ClientWorkflowVisualization from '../ClientWorkflowVisualization';
import WorkflowExecutionLogs from './WorkflowExecutionLogs';

interface WorkflowExecutionDetailsProps {
  executionId: string;
  onBack: () => void;
}

export function WorkflowExecutionDetails({ executionId, onBack }: WorkflowExecutionDetailsProps) {
  const [executionDetails, setExecutionDetails] = useState<{
    execution: IWorkflowExecution;
    events: any[];
    actionResults: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("visualization");

  // Use useCallback to memoize the fetchDetails function
  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const details = await getWorkflowExecutionDetails(executionId);
      if (details) {
        setExecutionDetails(details);
        setError(null);
      } else {
        setError('Workflow execution not found');
      }
    } catch (err) {
      console.error('Error fetching workflow execution details:', err);
      setError('Failed to load workflow execution details');
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDetails();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center mb-6">
          <Button id="back-button" variant="ghost" onClick={onBack} className="mr-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center mb-6">
          <Button id="back-button-error" variant="ghost" onClick={onBack} className="mr-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-semibold">Error</h1>
        </div>
        <div className="p-4 text-center text-red-500">
          {error}
        </div>
      </Card>
    );
  }

  if (!executionDetails) {
    return (
      <Card className="p-6">
        <div className="flex items-center mb-6">
          <Button id="back-button-not-found" variant="ghost" onClick={onBack} className="mr-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-semibold">Workflow Execution Not Found</h1>
        </div>
        <div className="p-4 text-center text-gray-500">
          The requested workflow execution could not be found.
        </div>
      </Card>
    );
  }

  const { execution, events, actionResults } = executionDetails;

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Button id="back-button-details" variant="ghost" onClick={onBack} className="mr-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-semibold">{execution.workflow_name}</h1>
          <span className={`ml-4 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(execution.status)}`}>
            {execution.status}
          </span>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={async () => {
            // Explicitly call handleRefresh function
            setRefreshing(true);
            try {
              await fetchDetails();
              console.log('Workflow execution details refreshed successfully');
            } catch (error) {
              console.error('Error refreshing workflow execution details:', error);
            } finally {
              setRefreshing(false);
            }
          }}
          disabled={refreshing}
          id="refresh-workflow-details-button"
        >
          {refreshing ? (
            <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Refreshing..." />
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-sm text-gray-500">Execution ID</p>
          <p className="font-medium">{execution.execution_id}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Current State</p>
          <p className="font-medium">{execution.current_state}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Created At</p>
          <p className="font-medium">{formatDate(execution.created_at)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Updated At</p>
          <p className="font-medium">{formatDate(execution.updated_at)}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
          <TabsTrigger value="events">Events ({events.length})</TabsTrigger>
          <TabsTrigger value="actions">Actions ({actionResults.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="context">Context Data</TabsTrigger>
        </TabsList>
        
        <TabsContent value="visualization" className="p-1">
          <div className="h-[500px] w-full border rounded-md overflow-hidden">
            <ClientWorkflowVisualization
              workflowDefinitionId={execution.workflow_name}
              executionId={execution.execution_id}
              height="100%"
              width="100%"
            />
          </div>
        </TabsContent>
        
        <TabsContent value="events">
          <div className="border rounded-md p-4">
            <WorkflowEventTimeline events={events} />
          </div>
        </TabsContent>
        <TabsContent value="logs">
          <div className="border rounded-md p-4">
            <WorkflowExecutionLogs
              executionId={execution.execution_id}
              events={events}
              actionResults={actionResults}
              onRefresh={handleRefresh}
            />
          </div>
        </TabsContent>
        
        <TabsContent value="actions">
          <div className="border rounded-md p-4">
            <WorkflowActionsList 
              actionResults={actionResults} 
              executionId={execution.execution_id} 
            />
          </div>
        </TabsContent>
        
        <TabsContent value="context">
          <div className="border rounded-md p-4">
            {execution.context_data ? (
              <pre className="bg-gray-50 p-4 rounded-md overflow-auto max-h-[400px] text-sm">
                {JSON.stringify(execution.context_data, null, 2)}
              </pre>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No context data available
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
