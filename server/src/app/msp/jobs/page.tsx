import { getQueueMetricsAction, getJobDetailsWithHistory } from '@/lib/actions/job-actions';
import { getWorkflowMetricsAction, getWorkflowExecutionsWithDetails } from '@/lib/actions/workflow-actions';
import WorkflowRegistryViewer from '@/components/workflows/WorkflowRegistryViewer';
import JobMetricsDisplay from '@/components/jobs/JobMetricsDisplay';
import JobHistoryTable from '@/components/jobs/JobHistoryTable';
import WorkflowMetricsDisplay from '@/components/workflows/WorkflowMetricsDisplay';
import WorkflowExecutionsTable from '@/components/workflows/WorkflowExecutionsTable';
import CustomTabs from '@/components/ui/CustomTabs';

export const revalidate = 5; // Revalidate every 5 seconds

export default async function JobMonitorPage() {
  // Fetch job data
  const jobMetrics = await getQueueMetricsAction();
  const jobHistory = await getJobDetailsWithHistory({ limit: 50 });
  
  // Fetch workflow data
  const workflowMetrics = await getWorkflowMetricsAction();
  const workflowExecutions = await getWorkflowExecutionsWithDetails({ limit: 50 });
  
  // Define tab content
  const tabs = [
    {
      label: "Jobs",
      content: (
        <div className="space-y-6">
          <JobMetricsDisplay metrics={jobMetrics} />
          <JobHistoryTable initialData={jobHistory} />
        </div>
      )
    },
    {
      label: "Workflows",
      content: (
        <div className="space-y-6">
          <WorkflowMetricsDisplay metrics={workflowMetrics} />
          <WorkflowRegistryViewer />
          <WorkflowExecutionsTable initialData={workflowExecutions} />
        </div>
      )
    }
  ];
  
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">
        System Monitoring
      </h1>
      
      <CustomTabs
        tabs={tabs}
        defaultTab="Jobs"
        tabStyles={{
          trigger: "data-automation-id='tab-trigger'",
          activeTrigger: "data-[state=active]:border-[rgb(var(--color-primary-500))] data-[state=active]:text-[rgb(var(--color-primary-600))]"
        }}
      />
    </div>
  );
}
