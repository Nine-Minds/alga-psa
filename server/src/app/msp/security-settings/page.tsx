import SecuritySettingsPage from '@/components/settings/security/SecuritySettingsPage';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.securitySettings.title', { defaultValue: 'Security Settings' }),
  };
}

export default function Page() {
  return <SecuritySettingsPage />;
}
