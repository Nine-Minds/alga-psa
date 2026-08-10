import SurveyDashboard from '@alga-psa/surveys/components/dashboard/SurveyDashboard';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.dashboard.title', { defaultValue: 'Survey Dashboard' }),
  };
}

export default function SurveyDashboardPage() {
  return <SurveyDashboard />;
}
