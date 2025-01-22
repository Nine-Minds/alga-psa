import { getQueueMetricsAction, getJobHistoryAction } from '@/lib/actions/job-actions';
import JobMetricsDisplay from '@/components/jobs/JobMetricsDisplay';
import JobHistoryTable from '@/components/jobs/JobHistoryTable';

export const revalidate = 5; // Revalidate every 5 seconds

export default async function JobMonitorPage() {
  const metrics = await getQueueMetricsAction();
  const jobHistory = await getJobHistoryAction({ limit: 50 });
  
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Job Monitoring</h1>
      
      <JobMetricsDisplay metrics={metrics} />
      
      <JobHistoryTable initialData={jobHistory} />
    </div>
  );
}