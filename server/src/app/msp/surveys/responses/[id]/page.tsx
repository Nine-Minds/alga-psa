import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.surveys.responses.detail.title', { defaultValue: 'Response Details' }),
  };
}

export default function SurveyResponseDetailPage() {
  // Detailed response views will be handled via drawers/modals from the responses dashboard.
  // Until then we can surface a 404 to avoid half-baked routes.
  return notFound();
}
