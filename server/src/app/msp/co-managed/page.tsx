import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedCustomerHome from '@/components/co-managed/CoManagedCustomerHome';
import { resolveCoManagedRootAccess } from '@/lib/co-managed/commercialAccess';
import CoManagedPurchaseOverview from '@enterprise/components/co-managed/CoManagedPurchaseOverview';
import CoManagedSeatTrial from '@enterprise/components/co-managed/CoManagedSeatTrial';
import CoManagedPurchasePool from '@enterprise/components/co-managed/CoManagedPurchasePool';

export async function generateMetadata(): Promise<Metadata> {
  // Same gate as the page: when it would 404, the tab must not read "Co-Managed IT".
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant) return {};
  try {
    const access = await resolveCoManagedRootAccess(tenant);
    if (!access.commercial && !access.trial) await requireCapabilityForPage('co-managed', tenant, 'serves');
  } catch {
    return {};
  }
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManaged.title', { defaultValue: 'Co-Managed IT' }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoManagedPage({ searchParams }: { searchParams?: Promise<{ clientId?: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  // One root, two sides, one gate: both are reads of existing state, so both
  // need only `serves` (the same gate that puts the menu item there; a served
  // sponsor must never get a menu item that 404s). Starting anything (setup,
  // Enable, seats) stays `admits`: the overview hides those entry points and the
  // server actions enforce it. algadesk never reaches here: the product boundary denies it.
  if (await getCurrentTenantProduct() === 'co_managed') {
    await requireCapabilityForPage('co-managed', tenant, 'serves');
    return <CoManagedCustomerHome />;
  }
  const access = await resolveCoManagedRootAccess(tenant);
  // Commercial eligibility alone gets the pool and nothing else: no client query is even read, so a
  // `clientId` confers no authority, and none of the operational readers mount.
  if (access.commercial && !access.operational) return <CoManagedPurchaseOverview />;
  if (access.trial && !access.operational) return <CoManagedSeatTrial />;
  if (!access.served) notFound();
  const clientId = (await searchParams)?.clientId;
  // When both paths apply, the existing overview carries the pool in place of its capacity line.
  return <CoManagedOverview
    initialClientId={typeof clientId === 'string' && UUID.test(clientId) ? clientId : undefined}
    purchasePool={access.commercial ? <CoManagedPurchasePool /> : access.trial ? <CoManagedSeatTrial /> : undefined} />;
}
