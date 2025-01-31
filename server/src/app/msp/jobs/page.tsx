import { getQueueMetricsAction, getJobDetailsWithHistory } from '@/lib/actions/job-actions';
import JobMetricsDisplay from '@/components/jobs/JobMetricsDisplay';
import JobHistoryTable from '@/components/jobs/JobHistoryTable';

export const revalidate = 5; // Revalidate every 5 seconds

export default async function JobMonitorPage() {
  const metrics = await getQueueMetricsAction();
  const jobHistory = await getJobDetailsWithHistory({ limit: 50 });
  
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">
        Job Monitoring
      </h1>
      
      <div className="space-y-6">
        <JobMetricsDisplay metrics={metrics} />
        <JobHistoryTable initialData={jobHistory} />
      </div>
    </div>
  );
}
