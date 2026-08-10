import { CreditsPage } from '@alga-psa/billing';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.billing.credits.title', { defaultValue: 'Credits' }),
  };
}

export default CreditsPage;
