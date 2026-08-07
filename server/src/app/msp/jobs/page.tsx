import { getQueueMetricsAction, getJobDetailsWithHistory } from '@alga-psa/jobs/actions';
import { JobMetricsDisplay, RecentJobsDataTable, ClearJobHistoryButton } from '@alga-psa/jobs/components';
import SystemMonitoringWrapper from '@alga-psa/ui/components/system-monitoring/SystemMonitoringWrapper';
import { Card } from '@alga-psa/ui/components/Card';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.jobs.title', { defaultValue: 'Jobs' }),
  };
}

export const dynamic = 'force-dynamic';

export default async function JobMonitorPage() {
  const { t } = await getServerTranslation(undefined, 'msp/jobs');

  // Fetch job data
  const jobMetrics = await getQueueMetricsAction();
  const jobHistory = await getJobDetailsWithHistory({ limit: 50 });

  // Only MSP users with the job:delete permission may clear history.
  const currentUser = await getCurrentUser();
  const canClearHistory = currentUser
    ? await hasPermission(currentUser, 'job', 'delete')
    : false;

  return (
    <SystemMonitoringWrapper>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">
            {t('page.heading', { defaultValue: 'Job Monitoring' })}
          </h1>
          <ClearJobHistoryButton canClear={canClearHistory} />
        </div>

        {/* Metrics Cards */}
        <JobMetricsDisplay metrics={jobMetrics} />

        {/* Job History Table */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4">
            {t('page.recentJobs', { defaultValue: 'Recent Jobs' })}
          </h2>
          <RecentJobsDataTable initialData={jobHistory} />
        </Card>
      </div>
    </SystemMonitoringWrapper>
  );
}
