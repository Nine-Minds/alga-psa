import { Suspense } from 'react';

import type { SurveyDashboardFilters } from '@alga-psa/types';
import { getSurveyDashboardData } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import ResponseMetrics from './ResponseMetrics';
import ResponseTrendChart from './ResponseTrendChart';
import SatisfactionDistribution from './SatisfactionDistribution';
import TopIssuesPanel from './TopIssuesPanel';
import ResponsesList from './ResponsesList';
import ChartSkeleton from '@alga-psa/ui/components/skeletons/ChartSkeleton';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

type SurveyDashboardProps = {
  filters?: SurveyDashboardFilters;
};

export default async function SurveyDashboard({ filters }: SurveyDashboardProps) {
  const data = await getSurveyDashboardData(filters);
  const { t } = await getServerTranslation(undefined, 'msp/surveys');

  return (
    <div className="space-y-8">
      <section className="animate-in fade-in-50 duration-500">
        <ResponseMetrics metrics={data.metrics} />
      </section>

      <section className="grid grid-cols-1 gap-6 2xl:grid-cols-3 animate-in fade-in-50 duration-700">
        <Suspense fallback={<ChartSkeleton type="line" />}>
          <ResponseTrendChart trend={data.trend} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton type="bar" />}>
          <SatisfactionDistribution distribution={data.distribution} />
        </Suspense>
        <Suspense
          fallback={
            <LoadingIndicator
              layout="stacked"
              text={t('dashboard.loadingInsights', {
                defaultValue: 'Loading survey insights...',
              })}
            />
          }
        >
          <TopIssuesPanel issues={data.topIssues} />
        </Suspense>
      </section>

      <section className="animate-in fade-in-50 duration-1000">
        <ResponsesList responses={data.recentResponses} />
      </section>
    </div>
  );
}
