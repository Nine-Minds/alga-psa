import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export { default } from '@product/extensions/pages/details';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.settings.extensions.detail.title', { defaultValue: 'Extension Details' }),
    description: t('msp.settings.extensions.detail.description', { defaultValue: 'View extension details' }),
  };
}
