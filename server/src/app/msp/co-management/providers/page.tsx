import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedProviderSetup from '@/components/co-managed/CoManagedProviderSetup';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.providers.title', { defaultValue: 'Email and Identity Providers' }),
  };
}

/**
 * Deliberately NOT wrapped in `CoManagedFeatureBoundary`, unlike its sibling
 * routes under `/msp/co-management`.
 *
 * This is a capability route, not collaboration UI. It configures the tenant's
 * own Google / Microsoft application for inbound email, staff sign-in and
 * directory setup, and the rest of that capability is already reachable with no
 * release flag at all: Settings -> Email -> Inbound renders the provider forms,
 * and the "Open Providers" entry point that leads here is gated only on
 * enterprise edition (`EmailProviderConfiguration.tsx` contains no reference to
 * `release-v1-6-feature`, `useFeatureFlag` or `CoManagedFeatureBoundary`).
 *
 * So gating the destination and not the entry point makes the flag produce a
 * dead end rather than hide a feature. `CoManagedFeatureBoundary` renders
 * `fallback ?? null`, and its own contract says a caller that replaces a whole
 * route must supply a fallback "or the route renders blank when the flag is
 * off". With the flag off this route therefore rendered a BLANK PAGE — strictly
 * worse than the "Page not available in your current product experience" card
 * this change set out to remove, and it would have made the flag responsible
 * for a customer-visible defect.
 *
 * Supplying a fallback was the other option and was rejected: any fallback that
 * is honest here just restates the dead end, and the customer still cannot store
 * the Entra application the product told it to register.
 *
 * Nothing is unguarded as a result. The product boundary is the
 * `msp_co_management_policy` route rule (psa/co_managed allowed, algadesk
 * not_found), RBAC stays `system_settings:update` inside the provider server
 * actions, and tenant ownership and secret redaction stay those actions' own.
 * No backend flag was introduced, and the release flag remains UI-only.
 */
export default function CoManagedProvidersPage() {
  return <CoManagedProviderSetup />;
}
