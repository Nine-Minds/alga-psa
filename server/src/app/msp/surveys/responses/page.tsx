import SurveyResponsesPage from '@alga-psa/surveys/components/responses/SurveyResponsesPage';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.responses.title', { defaultValue: 'Survey Responses' }),
  };
}

export default function SurveyResponsesRoute() {
  return <SurveyResponsesPage />;
}
