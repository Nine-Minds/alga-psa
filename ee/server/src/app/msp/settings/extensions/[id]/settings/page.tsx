import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export { default } from '@product/extensions/pages/settings';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.settings.extensions.detail.settings.title', { defaultValue: 'Extension Settings' }),
    description: t('msp.settings.extensions.detail.settings.description', { defaultValue: 'Configure extension settings' }),
  };
}
