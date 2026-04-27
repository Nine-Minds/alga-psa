import { Card } from '@alga-psa/ui/components/Card';
import { isTeamsEnterpriseEdition, TEAMS_AVAILABILITY_MESSAGES } from '@alga-psa/integrations/lib/teamsAvailability';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { ReactNode } from 'react';

async function renderUnavailableCard(message: string) {
  const { t } = await getServerTranslation(undefined, 'common');
  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">{t('pages.errors.teamsSignInUnavailable')}</h1>
        <p>{message}</p>
      </div>
    </Card>
  );
}

type EePopupCompleteModule = {
  default: () => ReactNode;
};

let eePagePromise: Promise<EePopupCompleteModule | null> | null = null;

export default async function TeamsTabPopupCompletePage() {
  if (!isTeamsEnterpriseEdition()) {
    return await renderUnavailableCard(TEAMS_AVAILABILITY_MESSAGES.ce_unavailable);
  }

  if (!eePagePromise) {
    eePagePromise = import('@enterprise/app/teams/auth/popup-complete/page')
      .then((module) => module as unknown as EePopupCompleteModule)
      .catch((error) => {
        console.error('[teams/auth/popup-complete] Failed to load EE page', error);
        return null;
      });
  }

  const eePage = await eePagePromise;
  if (!eePage?.default) {
    return await renderUnavailableCard(TEAMS_AVAILABILITY_MESSAGES.ce_unavailable);
  }

  return eePage.default();
}

export const dynamic = 'force-dynamic';
