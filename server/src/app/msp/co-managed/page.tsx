import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedCustomerHome from '@/components/co-managed/CoManagedCustomerHome';

export async function generateMetadata(): Promise<Metadata> {
  // Same gate as the page: when it would 404, the tab must not read "Co-Managed IT".
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant) return {};
  try {
    await requireCapabilityForPage('co-managed', tenant, 'serves');
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
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const clientId = (await searchParams)?.clientId;
  return <CoManagedOverview initialClientId={typeof clientId === 'string' && UUID.test(clientId) ? clientId : undefined} />;
}
