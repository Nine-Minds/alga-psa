import SurveySettings from '@alga-psa/surveys/components/SurveySettings';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.settings.title', { defaultValue: 'Survey Settings' }),
  };
}

export default function SurveySetupPage() {
  return <SurveySettings />;
}
