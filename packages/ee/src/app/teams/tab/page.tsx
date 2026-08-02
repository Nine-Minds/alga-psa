import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export default async function TeamsTabPage() {
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <div className="m-6">
      <UpgradePrompt
        featureName={t('pages.errors.teamsFeatureName', { defaultValue: 'Microsoft Teams integration' })}
        pitch={t('pages.errors.teamsEnterprisePitch', {
          defaultValue: 'Bring ticket context and technician workflows into Microsoft Teams.',
        })}
        ctaId="upgrade-teams-tab-button"
      />
    </div>
  );
}
