import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedSlaPolicyPanel from '@/components/co-managed/CoManagedSlaPolicyPanel';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.sla.title', { defaultValue: 'Co-Managed SLA Priorities' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedSlaPage({ searchParams }: { searchParams?: Promise<{ relationshipId?: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  // The MSP's own promise: only a sponsor admitted by the capability sees this configuration.
  await requireCapabilityForPage('co-managed', tenant, 'admits');
  const relationshipId = (await searchParams)?.relationshipId;
  return <CoManagedFeatureBoundary mode="admits" openWhenUnresolved>
    <CoManagedSlaPolicyPanel initialRelationshipId={typeof relationshipId === 'string' ? relationshipId : undefined} />
  </CoManagedFeatureBoundary>;
}
