import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const metadata = {
  title: 'Extensions (EE only)'
};

type PageParams = { id: string };

export default async function Page({ params }: { params: PageParams | Promise<PageParams> }) {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  const resolvedParams = await params;

  return (
    <div className="p-6">
      <UpgradePrompt
        featureName={t('page.title', { defaultValue: 'Extensions' })}
        pitch={t('enterpriseFeature.description', {
          defaultValue: '{{feature}} requires Enterprise Edition. Upgrade to install and run extensions.',
          feature: t('page.title', { defaultValue: 'Extensions' }),
        })}
        ctaId="upgrade-extension-page-button"
      >
        <p>
          {t('detail.extensionId', {
            defaultValue: 'Extension ID: {{id}}',
            id: resolvedParams.id,
          })}
        </p>
      </UpgradePrompt>
    </div>
  );
}
