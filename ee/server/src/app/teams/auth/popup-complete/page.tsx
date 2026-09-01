import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { TeamsTabPopupCompletePage } from '@alga-psa/ee-microsoft-teams/routes';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('teams.auth.popupComplete.title', { defaultValue: 'Teams Authentication' }),
  };
}

export default TeamsTabPopupCompletePage;
