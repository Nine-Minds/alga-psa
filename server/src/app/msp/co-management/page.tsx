import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.coManagement.title', { defaultValue: 'Co-Managed Access' }) };
}

/** L1a has no access-policy surface yet; the sponsor entry point is the overview. */
export default async function CoManagementPage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'admits');
  redirect('/msp/co-managed');
}
