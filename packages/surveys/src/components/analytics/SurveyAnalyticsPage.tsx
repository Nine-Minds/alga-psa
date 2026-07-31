import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { getSurveyDashboardData } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import FilterPanel from './FilterPanel';
import ResponseAnalyticsChart from './ResponseAnalyticsChart';
import ExportOptions from './ExportOptions';
import SurveyPrintReport from '../SurveyPrintReport';

export default async function SurveyAnalyticsPage() {
  const dashboardData = await getSurveyDashboardData();
  const { t } = await getServerTranslation(undefined, 'msp/surveys');
  const chartData = dashboardData.trend.map((point) => ({
    label: point.date,
    averageRating: point.averageRating ?? 0,
    responseRate: dashboardData.metrics.responseRate,
    responseCount: point.responseCount,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            {t('analytics.page.filtersTitle', { defaultValue: 'Analytics Filters' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FilterPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              {t('analytics.page.overviewTitle', { defaultValue: 'Satisfaction Overview' })}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('analytics.page.overviewDescription', {
                defaultValue: 'Compare average satisfaction and response rates over time. Additional segmentation will arrive in later iterations.',
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportOptions />
            <PrintButton id="survey-analytics-print" variant="outline" />
          </div>
        </CardHeader>
        <CardContent>
          <ResponseAnalyticsChart data={chartData} />
        </CardContent>
      </Card>

      <SurveyPrintReport
        data={dashboardData}
        title={t('analytics.page.overviewTitle', { defaultValue: 'Satisfaction Overview' })}
        subtitle={t('analytics.page.overviewDescription', {
          defaultValue: 'Compare average satisfaction and response rates over time. Additional segmentation will arrive in later iterations.',
        })}
        sections={['trend']}
      />
    </div>
  );
}
