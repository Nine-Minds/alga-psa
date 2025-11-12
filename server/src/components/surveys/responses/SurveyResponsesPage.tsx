import SurveyResponsesView from 'server/src/components/surveys/responses/SurveyResponsesView';
import { getSurveyResponsesPage } from 'server/src/lib/actions/survey-actions/surveyAnalyticsActions';
import { getSurveyFilterOptions } from 'server/src/lib/actions/survey-actions/surveyResponseFilterActions';

export default async function SurveyResponsesPage() {
  const [filterOptions, initialPage] = await Promise.all([
    getSurveyFilterOptions(),
    getSurveyResponsesPage({ pageSize: 25 }),
  ]);

  return (
    <SurveyResponsesView filterOptions={filterOptions} initialPage={initialPage} />
  );
}
