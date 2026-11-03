import { cache } from "react";
import { cookies } from "next/headers.js";
import { redirect } from "next/navigation";
import { getSession, getSessionWithRevocationCheck } from "@alga-psa/auth";
import { isLicensedUserType } from "@alga-psa/types";
import { getTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { getWorkspaceSetupAccess } from "@alga-psa/onboarding/actions/onboarding-actions/onboardingActions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale";
import { MspLayoutClient } from "./MspLayoutClient";
import { getCoManagedWorkspaceState } from "@/lib/actions/coManagedWorkspaceActions";
import type { CoManagedWorkspaceNoticeState } from "@/components/co-managed/CoManagedWorkspaceNotice";
import { getCurrentTenantProduct } from "@/lib/productAccess";
import { productUsesWorkspaceOnboarding } from '@/lib/workspaceOnboardingPolicy';
import { getTenantDefaultCurrencyCode } from "@alga-psa/billing/actions/billingCurrencyActions";
import { getDateFormatPreference } from "@alga-psa/clients/actions/countryActions";
import { SYSTEM_DATE_FORMAT } from "@alga-psa/core/i18n/countryDateFormat";
import { preloadLocaleResources } from "@/lib/i18n/preloadLocaleResources";
import { isSelfHostLicensing } from "@alga-psa/licensing";
import { isEnterprise } from "@alga-psa/core/features";
import { getTenantBrandingByTenantId } from "@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain";
import { getTenantThemeByTenantId } from "@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions";
import { resolveMspBranding } from "@/components/layout/mspBranding";
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

/**
 * Client-portal branding must never leak into the staff app by itself. The
 * dedicated Enterprise white-label setting is the explicit MSP opt-in.
 *
 * generateMetadata and the layout body both need this, so cache() keeps it to
 * one round trip per request.
 */
const loadMspWhiteLabel = cache(async (tenantId: string) => {
  const tenantTheme = isEnterprise
    ? await getTenantThemeByTenantId(tenantId).catch(() => null)
    : null;
  const mspWhiteLabel = tenantTheme?.mspWhiteLabel === true;
  const tenantBranding = mspWhiteLabel
    ? await getTenantBrandingByTenantId(tenantId).catch(() => null)
    : null;

  return { mspWhiteLabel, tenantBranding };
});

// This template overrides the root layout's template for all /msp/* pages.
// The default includes the suffix because defaults bypass their own template
// (i.e. 'Dashboard | AlgaPSA' is rendered literally, not wrapped by the template).
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  const metadata: Metadata = {
    title: {
      // '%s' is Next's own slot for the child route's title, not an i18next
      // placeholder — it passes through translation untouched.
      template: '%s | AlgaPSA',
      default: t('msp.layout.defaultTitle', { defaultValue: 'Dashboard | AlgaPSA' }),
    },
  };

  // A white-labeled tenant owns the browser tab too. Next merges icons from the
  // leaf segment, so this replaces the root layout's /favicon.ico.
  const session = await getSession().catch(() => null);
  const tenantId = session?.user?.tenant;
  if (tenantId) {
    const { tenantBranding } = await loadMspWhiteLabel(tenantId);
    if (tenantBranding?.faviconUrl) {
      metadata.icons = { icon: tenantBranding.faviconUrl };
    }
  }

  return metadata;
}

export default async function MspLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // Parallel slot for app-wide intercepting modal routes (e.g. create-ticket). Falls back
  // to @modal/default.tsx (null) on routes that don't open a modal.
  modal: React.ReactNode;
}>) {
  // Use full auth with revocation check so terminated sessions cannot keep browsing
  const session =
    (await getSessionWithRevocationCheck()) ??
    (process.env.NODE_ENV !== 'production' ? await getSession() : null);

  // If session is null, redirect to signin
  // Don't include error parameter to avoid redirect loops
  if (!session) {
    console.log('[msp-layout] No session found, redirecting to signin');
    redirect('/auth/msp/signin');
  }

  // Only internal users belong in the MSP portal. Client users are in the wrong portal;
  // a non-interactive type must never hold a UI session, so send both to sign-in rather
  // than to the client portal.
  if (!isLicensedUserType(session.user.user_type)) {
    console.log('[msp-layout] Non-internal session trying to access MSP portal, redirecting to sign-in');
    redirect('/auth/msp/signin');
  }

  const productCode = await getCurrentTenantProduct();

  // Only a customer workspace has a relationship notice; psa and algadesk read nothing.
  // A failed or gated read is no notice: the shell must never block on it.
  const workspaceNotice: CoManagedWorkspaceNoticeState = productCode === 'co_managed'
    ? await getCoManagedWorkspaceState()
        .then((state) => (state.kind === 'ended' ? { kind: 'ended' as const, endedAt: state.endedAt, sponsorName: state.sponsorName } : null))
        .catch(() => null)
    : null;

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  let needsOnboarding = false;
  let onboardingResolvedServerSide = false;
  try {
    if (!productUsesWorkspaceOnboarding(productCode)) {
      onboardingResolvedServerSide = true;
    } else {
      const tenantSettings = await getTenantSettings();
      if (tenantSettings) {
        needsOnboarding = !tenantSettings.onboarding_completed && !tenantSettings.onboarding_skipped;
        onboardingResolvedServerSide = true;
      }
    }
  } catch (error) {
    console.error('Failed to load tenant settings for onboarding check:', error);
  }
  // Only an administrator is sent to workspace setup; other users work in the
  // workspace as configured so far instead of being stuck on a wizard they
  // cannot complete.
  const canRunOnboarding = productUsesWorkspaceOnboarding(productCode) && await getWorkspaceSetupAccess().then(access => access.canRun).catch(() => false);
  needsOnboarding = needsOnboarding && canRunOnboarding;

  const locale = await getHierarchicalLocaleAction();
  const preloadedLocaleResources = await preloadLocaleResources(locale).catch(() => undefined);
  // Only self-host installs carry a license_state row; gate the trial/expiry
  // banner here so it never mounts (or calls getLicenseStatus) on hosted/SaaS.
  const selfHostLicensing = await isSelfHostLicensing();
  const currencyCode = await getTenantDefaultCurrencyCode().catch(() => 'USD');
  // Digit order / separator / clock follow the tenant's country, never the language.
  const dateFormat = await getDateFormatPreference().catch(() => SYSTEM_DATE_FORMAT);

  const tenantId = session.user.tenant;
  const { mspWhiteLabel, tenantBranding } = tenantId
    ? await loadMspWhiteLabel(tenantId)
    : { mspWhiteLabel: false, tenantBranding: null };
  const mspBranding = resolveMspBranding(tenantBranding, { isEnterprise, mspWhiteLabel });

  return (
    <MspLayoutClient
      mspBranding={mspBranding}
      session={session}
      currencyCode={currencyCode}
      dateFormat={dateFormat}
      productCode={productCode}
      workspaceNotice={workspaceNotice}
      needsOnboarding={needsOnboarding}
      canRunOnboarding={canRunOnboarding}
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialLocale={locale}
      preloadedLocaleResources={preloadedLocaleResources}
      onboardingResolvedServerSide={onboardingResolvedServerSide}
      selfHostLicensing={selfHostLicensing}
    >
      {children}
      {modal}
    </MspLayoutClient>
  );
}
