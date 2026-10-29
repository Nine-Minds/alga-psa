import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedCustomerHome from '@/components/co-managed/CoManagedCustomerHome';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManaged.title', { defaultValue: 'Co-Managed IT' }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoManagedPage({ searchParams }: { searchParams?: Promise<{ clientId?: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  // One root, two sides: a customer workspace sees its own relationship home
  // (existing state, so `serves`); the sponsor's overview is an entry point
  // (`admits`). algadesk never reaches here: the product boundary denies it.
  if (await getCurrentTenantProduct() === 'co_managed') {
    await requireCapabilityForPage('co-managed', tenant, 'serves');
    return <CoManagedCustomerHome />;
  }
  await requireCapabilityForPage('co-managed', tenant, 'admits');
  const clientId = (await searchParams)?.clientId;
  return <CoManagedOverview initialClientId={typeof clientId === 'string' && UUID.test(clientId) ? clientId : undefined} />;
}
