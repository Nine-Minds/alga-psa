import { FeaturePlaceholder } from '@alga-psa/ui/components/feature-flags/FeaturePlaceholder';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.assets.integrations.title', { defaultValue: 'Asset Integrations' }),
  };
}

export default function AssetIntegrationsPage() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-white">
      <FeaturePlaceholder />
    </div>
  );
}
