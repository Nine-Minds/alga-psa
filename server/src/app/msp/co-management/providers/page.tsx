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
 * For a co-managed tenant the wrapper here was **redundant**:
 * `MspLayoutClient` already wraps the entire MSP shell in
 * `CoManagedWorkspaceBoundary`, which is `CoManagedFeatureBoundary` for
 * `productCode === 'co_managed'`. Walked with `release-v1-6-feature` forced off,
 * `/msp/dashboard`, `/msp/tickets` and `/msp/settings/email` all render an empty
 * `main` for this product — so the flag decides whether the co-managed app
 * exists at all, and a second gate on one route inside it changes nothing.
 * (That shell-wide blanking has no fallback and is a real defect, but it is
 * pre-existing and shell-owned; it is reported, not fixed here.)
 *
 * For `psa`, which this route's rule also allows and which the shell boundary
 * does not wrap, the page-level gate WAS the only gate — and it gated a surface
 * PSA already reaches unflagged at
 * `/msp/settings/integrations?category=providers`. Removing it exposes nothing
 * new.
 *
 * Keeping it would also be forward-wrong. This is a capability route, not
 * collaboration UI: it configures the tenant's own Google / Microsoft
 * application, and the "Open Providers" entry point that leads here is gated
 * only on enterprise edition (`EmailProviderConfiguration.tsx` references
 * neither `release-v1-6-feature`, `useFeatureFlag` nor
 * `CoManagedFeatureBoundary`). If the shell boundary ever gains the fallback it
 * is missing, a surviving gate on this route alone would turn the flag into a
 * dead end for a capability whose entry point is not flag-gated —
 * `CoManagedFeatureBoundary` renders `fallback ?? null`, and its own contract
 * says a caller replacing a whole route must supply one "or the route renders
 * blank when the flag is off".
 *
 * Nothing becomes unguarded. The product boundary is the
 * `msp_co_management_policy` route rule (psa/co_managed allowed, algadesk
 * not_found), RBAC stays `system_settings:update` inside the provider server
 * actions, and tenant ownership and secret redaction stay those actions' own.
 * No backend flag was introduced; the release flag remains UI-only.
 */
export default function CoManagedProvidersPage() {
  return <CoManagedProviderSetup />;
}
