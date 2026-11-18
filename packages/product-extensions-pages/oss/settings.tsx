import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return { title: t('settingsPage.unavailable.metadataTitle') };
}

export default async function Page() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{t('settingsPage.unavailable.title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('settingsPage.unavailable.description')}</p>
    </div>
  );
}
