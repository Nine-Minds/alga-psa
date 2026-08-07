import SurveyAnalyticsPage from '@alga-psa/surveys/components/analytics/SurveyAnalyticsPage';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.analytics.title', { defaultValue: 'Survey Analytics' }),
  };
}

export default function SurveyAnalyticsRoute() {
  return <SurveyAnalyticsPage />;
}
