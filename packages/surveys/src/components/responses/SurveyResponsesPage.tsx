import SurveyResponsesView from './SurveyResponsesView';
import { getSurveyResponsesPage } from '@alga-psa/surveys/actions/survey-actions/surveyAnalyticsActions';
import { getSurveyFilterOptions } from '@alga-psa/surveys/actions/survey-actions/surveyResponseFilterActions';

export default async function SurveyResponsesPage() {
  const [filterOptions, initialPage] = await Promise.all([
    getSurveyFilterOptions(),
    getSurveyResponsesPage({ pageSize: 25 }),
  ]);

  return (
    <SurveyResponsesView filterOptions={filterOptions} initialPage={initialPage} />
  );
}
