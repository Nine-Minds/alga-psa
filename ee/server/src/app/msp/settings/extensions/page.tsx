import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export { default } from '@product/extensions/pages/list';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.settings.extensions.title', { defaultValue: 'Extensions' }),
    description: t('msp.settings.extensions.description', { defaultValue: 'Manage extensions' }),
  };
}
