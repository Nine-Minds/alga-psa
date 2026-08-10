import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.title', { defaultValue: 'Surveys' }),
  };
}

export default function SurveysIndexPage() {
  redirect('/msp/surveys/dashboard');
}
