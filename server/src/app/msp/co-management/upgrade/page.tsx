import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedUpgrade from '@/components/co-managed/CoManagedUpgrade';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.upgrade.title', { defaultValue: 'Upgrade to AlgaPSA' }),
  };
}

export default function CoManagedUpgradePage() {
  return <CoManagedFeatureBoundary><CoManagedUpgrade /></CoManagedFeatureBoundary>;
}
