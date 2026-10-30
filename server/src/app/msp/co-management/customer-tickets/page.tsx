import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedCustomerTickets from '@/components/co-managed/CoManagedCustomerTickets';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.customerTickets.title', { defaultValue: 'Customer Tickets' }) };
}

// Mount point: L1b Oversight shell absorbs this route
export default async function CoManagedCustomerTicketsPage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved><CoManagedCustomerTickets /></CoManagedFeatureBoundary>;
}
