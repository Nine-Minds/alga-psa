import type { Metadata } from 'next';
import { Card } from '@alga-psa/ui/components/Card';
import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { isTeamsEnterpriseEdition } from '@alga-psa/integrations/lib/teamsAvailabilityCore';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('teams.tab.title', { defaultValue: 'Teams' }),
  };
}

interface TeamsTabPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const PUBLIC_TEAMS_UNAVAILABLE_MESSAGE = 'Microsoft Teams integration is only available in Pro.';

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

async function renderEditionUpgradePrompt() {
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <div className="m-6">
      <UpgradePrompt
        featureName={t('pages.errors.teamsFeatureName', { defaultValue: 'Microsoft Teams integration' })}
        pitch={t('pages.errors.teamsEnterprisePitch', {
          defaultValue: 'Bring ticket context and technician workflows into Microsoft Teams.',
        })}
        ctaId="upgrade-teams-integration-button"
      />
    </div>
  );
}

type EeTeamsTabPageModule = {
  default: (props: TeamsTabPageProps) => Promise<ReactNode>;
};

let eePagePromise: Promise<EeTeamsTabPageModule | null> | null = null;

export default async function TeamsTabPage({ searchParams }: TeamsTabPageProps) {
  if (!isTeamsEnterpriseEdition()) {
    return await renderEditionUpgradePrompt();
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
    return await renderUnavailableCard(PUBLIC_TEAMS_UNAVAILABLE_MESSAGE);
  }

  return eePage.default({ searchParams });
}

export const dynamic = 'force-dynamic';
