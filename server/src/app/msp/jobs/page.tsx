import { getQueueMetricsAction, getJobDetailsWithHistory } from '@alga-psa/jobs/actions';
import { JobMetricsDisplay, RecentJobsDataTable } from '@alga-psa/jobs/components';
import SystemMonitoringWrapper from '@alga-psa/ui/components/system-monitoring/SystemMonitoringWrapper';
import { Card } from '@alga-psa/ui/components/Card';

export const dynamic = 'force-dynamic';

export default async function JobMonitorPage() {
  // Fetch job data
  const jobMetrics = await getQueueMetricsAction();
  const jobHistory = await getJobDetailsWithHistory({ limit: 50 });

  return (
    <SystemMonitoringWrapper>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">
            Job Monitoring
          </h1>
          <p className="text-[rgb(var(--color-text-600))] mt-2">
            Monitor background jobs, track execution status, and view detailed job history
          </p>
        </div>

        {/* Metrics Cards */}
        <JobMetricsDisplay metrics={jobMetrics} />

        {/* Job History Table */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">
              Recent Jobs
            </h2>
            <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">
              Click on any job to view detailed execution information
            </p>
          </div>
          <RecentJobsDataTable initialData={jobHistory} />
        </Card>
      </div>
    </SystemMonitoringWrapper>
  );
}
