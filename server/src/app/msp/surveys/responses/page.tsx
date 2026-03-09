import SurveyResponsesPage from '@alga-psa/surveys/components/responses/SurveyResponsesPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Survey Responses',
};

export default function SurveyResponsesRoute() {
  return <SurveyResponsesPage />;
}
