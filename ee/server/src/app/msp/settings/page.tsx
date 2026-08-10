import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.settings.title', { defaultValue: 'Settings' }),
  };
}

export default function SettingsIndex({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawTab = searchParams?.tab;
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  if (tab && tab.toLowerCase() === 'extensions') {
    redirect('/msp/settings/extensions');
  }
  // Default to extensions for now (EE focuses on Extensions settings)
  redirect('/msp/settings/extensions');
}
