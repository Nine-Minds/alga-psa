import { Card } from '@alga-psa/ui/components/Card';
import { isTeamsEnterpriseEdition, TEAMS_AVAILABILITY_MESSAGES } from '@alga-psa/integrations/lib/teamsAvailability';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { ReactNode } from 'react';

interface TeamsTabPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

async function renderUnavailableCard(message: string) {
  const { t } = await getServerTranslation(undefined, 'common');
  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-2">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-gray-900">{t('pages.errors.teamsTabUnavailable')}</h1>
        </div>
        <p>{message}</p>
        <p>{t('pages.errors.teamsTabEnableHint', { defaultValue: 'Ask a PSA administrator to enable the Teams integration for this tenant before reopening the tab.' })}</p>
      </div>
    </Card>
  );
}

type EeTeamsTabPageModule = {
  default: (props: TeamsTabPageProps) => Promise<ReactNode>;
};

let eePagePromise: Promise<EeTeamsTabPageModule | null> | null = null;

export default async function TeamsTabPage({ searchParams }: TeamsTabPageProps) {
  if (!isTeamsEnterpriseEdition()) {
    return await renderUnavailableCard(TEAMS_AVAILABILITY_MESSAGES.ce_unavailable);
  }

  if (!eePagePromise) {
    eePagePromise = import('@enterprise/app/teams/tab/page')
      .then((module) => module as unknown as EeTeamsTabPageModule)
      .catch((error) => {
        console.error('[teams/tab] Failed to load EE page', error);
        return null;
      });
  }

  const eePage = await eePagePromise;
  if (!eePage?.default) {
    return await renderUnavailableCard(TEAMS_AVAILABILITY_MESSAGES.ce_unavailable);
  }

  return eePage.default({ searchParams });
}

export const dynamic = 'force-dynamic';
