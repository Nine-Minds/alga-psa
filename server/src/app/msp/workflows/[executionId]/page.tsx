import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getWorkflowExecutionDetails } from 'server/src/lib/actions/workflow-actions';
import ClientWorkflowVisualization from '@product/workflows/workflows/ClientWorkflowVisualization';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import Link from 'next/link';
import WorkflowEventTimeline from '@product/workflows/workflows/WorkflowEventTimeline';
import WorkflowActionsList from '@product/workflows/workflows/WorkflowActionsList';
import WorkflowControls from '@product/workflows/workflows/WorkflowControls';

export const dynamic = 'force-dynamic';

interface WorkflowDetailPageProps {
  params: Promise<{
    executionId: string;
  }>;
}
export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  const resolvedParams = await params;
  const { executionId } = resolvedParams;
  
  // Get workflow execution details
  const workflowDetails = await getWorkflowExecutionDetails(executionId);
  
  if (!workflowDetails) {
    notFound();
  }
  
  // Extract the workflow details
  const { execution, events, actionResults } = workflowDetails;
  
  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))] mb-2">
            <Link href="/msp/jobs" className="hover:text-[rgb(var(--color-primary-600))]">
              Job Monitoring
            </Link>
            <span>›</span>
            <span>Workflow Details</span>
          </div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">
            {execution.workflow_name}
          </h1>
        </div>
        
        <WorkflowControls execution={execution} />
      </div>
      
      {/* Workflow Metadata */}
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-sm font-medium text-[rgb(var(--color-text-500))]">
              Status
            </div>
            <div className="mt-1">
              <span className={`font-medium px-2 py-1 rounded ${
                execution.status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
                execution.status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' :
                execution.status === 'active' ? 'bg-[rgb(var(--color-info-50))] text-[rgb(var(--color-info-600))]' :
                execution.status === 'paused' ? 'bg-[rgb(var(--color-warning-50))] text-[rgb(var(--color-warning-600))]' :
                'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
              }`}>
                {execution.status.charAt(0).toUpperCase() + execution.status.slice(1)}
              </span>
            </div>
          </div>
          
          <div>
            <div className="text-sm font-medium text-[rgb(var(--color-text-500))]">
              Current State
            </div>
            <div className="mt-1 font-medium text-[rgb(var(--color-text-900))]">
              {execution.current_state}
            </div>
          </div>
          
          <div>
            <div className="text-sm font-medium text-[rgb(var(--color-text-500))]">
              Created
            </div>
            <div className="mt-1 font-medium text-[rgb(var(--color-text-900))]">
              {new Date(execution.created_at).toLocaleString()}
            </div>
          </div>
          
          <div>
            <div className="text-sm font-medium text-[rgb(var(--color-text-500))]">
              Last Updated
            </div>
            <div className="mt-1 font-medium text-[rgb(var(--color-text-900))]">
              {new Date(execution.updated_at).toLocaleString()}
            </div>
          </div>
        </div>
      </Card>
      
      {/* Workflow Visualization */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4">
          Workflow Visualization
        </h2>
        <div className="h-[500px] w-full">
          <Suspense fallback={<div>Loading visualization...</div>}>
            <ClientWorkflowVisualization
              workflowDefinitionId={execution.workflow_name}
              executionId={executionId}
              height={450}
              width="100%"
              showControls={true}
              showLegend={true}
              pollInterval={5000}
            />
          </Suspense>
        </div>
      </Card>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Event Timeline */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4">
            Event Timeline
          </h2>
          <Suspense fallback={<div>Loading events...</div>}>
            <WorkflowEventTimeline events={events} />
          </Suspense>
        </Card>
        
        {/* Action Results */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4">
            Action Results
          </h2>
          <Suspense fallback={<div>Loading actions...</div>}>
            <WorkflowActionsList 
              actionResults={actionResults} 
              executionId={executionId} 
            />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
