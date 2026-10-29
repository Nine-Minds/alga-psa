import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedProviderSetup from '@/components/co-managed/CoManagedProviderSetup';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.providers.title', { defaultValue: 'Email and Identity Providers' }),
  };
}

/**
 * Customer-owned Google / Microsoft provider setup.
 *
 * Gated by the co-managed capability in `serves` mode: a workspace that already
 * participates keeps this page when the rollout flag flips, and a tenant that
 * does not participate gets `notFound` before anything is rendered. The page
 * adds no persistence and relaxes no guard; RBAC (`system_settings:update`),
 * tenant ownership and secret redaction stay inside the provider actions.
 */
export default async function CoManagedProvidersPage() {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <CoManagedProviderSetup />;
}
