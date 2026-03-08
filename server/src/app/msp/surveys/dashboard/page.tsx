import SurveyDashboard from '@alga-psa/surveys/components/dashboard/SurveyDashboard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Survey Dashboard',
};

export default function SurveyDashboardPage() {
  return <SurveyDashboard />;
}
