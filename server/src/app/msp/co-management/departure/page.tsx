import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedDeparture from '@/components/co-managed/CoManagedDeparture';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.departure.title', { defaultValue: 'End Co-Managed IT' }) };
}

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown) => typeof value === 'string' && UUID.test(value) ? value : undefined;

// `serves`, never `admits`: a lapsed or entitlement-less relationship must still be endable.
export default async function CoManagedDeparturePage({ searchParams }: { searchParams?: Promise<{ clientId?: string; relationshipId?: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const query = await searchParams;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedDeparture clientId={uuid(query?.clientId)} relationshipId={uuid(query?.relationshipId)} />
  </CoManagedFeatureBoundary>;
}
