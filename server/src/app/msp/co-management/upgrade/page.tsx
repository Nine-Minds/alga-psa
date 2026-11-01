import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedUpgrade from '@/components/co-managed/CoManagedUpgrade';
import { getCoManagedUpgradeAccessAction } from '@ee/lib/actions/coManagedUpgradeActions';

/**
 * One server-side gate (resolveCoManagedUpgradeAccess, via the EE action) shared with the screen action:
 * kill switch, release flag, then customer (serves + relationship) or former customer (upgrade row).
 * Sponsors and everyone else are 'closed'. A lookup failure is closed too.
 */
async function upgradeAccess(): Promise<'customer' | 'former' | 'closed'> {
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant) return 'closed';
  try {
    return (await getCoManagedUpgradeAccessAction()).access;
  } catch {
    return 'closed';
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Same gate as the page: when it would 404, the tab must not read "Upgrade to AlgaPSA".
  if (await upgradeAccess() === 'closed') return {};
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.upgrade.title', { defaultValue: 'Upgrade to AlgaPSA' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedUpgradePage() {
  const access = await upgradeAccess();
  if (access === 'closed') notFound();
  // A former customer no longer serves, so the serves-mode boundary would hide the completed screen.
  if (access === 'former') return <CoManagedUpgrade />;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedUpgrade /></CoManagedFeatureBoundary>;
}
