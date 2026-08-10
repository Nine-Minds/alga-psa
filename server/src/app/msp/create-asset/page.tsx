import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateAssetRouteClient from '../_components/CreateAssetRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createAsset.title', { defaultValue: 'Create Asset' }),
  };
}

export default function CreateAssetPage() {
  return <CreateAssetRouteClient closeMode="replace" />;
}
