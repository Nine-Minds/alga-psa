import SurveyAnalyticsPage from '@alga-psa/surveys/components/analytics/SurveyAnalyticsPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Survey Analytics',
};

export default function SurveyAnalyticsRoute() {
  return <SurveyAnalyticsPage />;
}
