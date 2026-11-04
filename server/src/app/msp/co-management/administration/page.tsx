import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedAdministration from '@/components/co-managed/CoManagedAdministration';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.administration.title', { defaultValue: 'Co-Managed Administration' }) };
}

export const dynamic = 'force-dynamic';

export default async function CoManagedAdministrationPage({ searchParams }: { searchParams?: Promise<{ relationshipId?: string }> }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const relationshipId = (await searchParams)?.relationshipId;
  return <CoManagedFeatureBoundary mode="serves" openWhenUnresolved>
    <CoManagedAdministration initialRelationshipId={typeof relationshipId === 'string' ? relationshipId : undefined} />
  </CoManagedFeatureBoundary>;
}
