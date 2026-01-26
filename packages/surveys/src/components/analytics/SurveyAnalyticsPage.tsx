import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { getSurveyDashboardData } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import FilterPanel from './FilterPanel';
import ResponseAnalyticsChart from './ResponseAnalyticsChart';
import ExportOptions from './ExportOptions';

export default async function SurveyAnalyticsPage() {
  const dashboardData = await getSurveyDashboardData();
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
          <CardTitle className="text-base font-semibold">Analytics Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <FilterPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Satisfaction Overview</CardTitle>
            <p className="text-sm text-muted-foreground">
              Compare average satisfaction and response rates over time. Additional segmentation will
              arrive in later iterations.
            </p>
          </div>
          <ExportOptions />
        </CardHeader>
        <CardContent>
          <ResponseAnalyticsChart data={chartData} />
        </CardContent>
      </Card>
    </div>
  );
}
