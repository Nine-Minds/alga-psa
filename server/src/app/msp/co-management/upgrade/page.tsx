import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedUpgrade from '@/components/co-managed/CoManagedUpgrade';
import { getCoManagedUpgradeAudienceAction } from '@ee/lib/actions/coManagedUpgradeActions';

/**
 * The page exists only for a co-managed customer or a former customer with a completed upgrade (sponsors
 * also pass the `serves` gate but have nothing to upgrade). The `serves` gate stays first (flag off and
 * the kill switch included). A closed gate still lets a tenant with an upgrade row through, so a former
 * customer that no longer participates keeps its completed screen; that path never queries relationships.
 */
async function audienceAdmitted(tenant: string): Promise<boolean> {
  let serves = true;
  try {
    await requireCapabilityForPage('co-managed', tenant, 'serves');
  } catch {
    serves = false;
  }
  try {
    return (await getCoManagedUpgradeAudienceAction(serves)).audience;
  } catch {
    return false;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Same gate as the page: when it would 404, the tab must not read "Upgrade to AlgaPSA".
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant || !(await audienceAdmitted(tenant))) return {};
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.upgrade.title', { defaultValue: 'Upgrade to AlgaPSA' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedUpgradePage() {
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant || !(await audienceAdmitted(tenant))) notFound();
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedUpgrade /></CoManagedFeatureBoundary>;
}
