import { Suspense } from 'react';

import type { SurveyDashboardFilters } from 'server/src/interfaces/survey.interface';
import { getSurveyDashboardData } from 'server/src/lib/actions/survey-actions/surveyDashboardActions';
import ResponseMetrics from './ResponseMetrics';
import ResponseTrendChart from './ResponseTrendChart';
import SatisfactionDistribution from './SatisfactionDistribution';
import TopIssuesPanel from './TopIssuesPanel';
import ResponsesList from './ResponsesList';
import ChartSkeleton from 'server/src/components/ui/skeletons/ChartSkeleton';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

type SurveyDashboardProps = {
  filters?: SurveyDashboardFilters;
};

export default async function SurveyDashboard({ filters }: SurveyDashboardProps) {
  const data = await getSurveyDashboardData(filters);

  return (
    <div className="space-y-6">
      <ResponseMetrics metrics={data.metrics} />

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        <Suspense fallback={<ChartSkeleton type="line" />}>
          <ResponseTrendChart trend={data.trend} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton type="bar" />}>
          <SatisfactionDistribution distribution={data.distribution} />
        </Suspense>
        <Suspense fallback={<LoadingIndicator layout="stacked" text="Loading survey insights..." />}>
          <TopIssuesPanel issues={data.topIssues} />
        </Suspense>
      </div>

      <ResponsesList responses={data.recentResponses} />
    </div>
  );
}
