import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedUpgrade from '@/components/co-managed/CoManagedUpgrade';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.upgrade.title', { defaultValue: 'Upgrade to AlgaPSA' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedUpgradePage() {
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant) notFound();
  // Flag off, or no co-managed entitlement: the route does not exist. FORCE_CAPABILITIES=co-managed:off included.
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedUpgrade /></CoManagedFeatureBoundary>;
}
