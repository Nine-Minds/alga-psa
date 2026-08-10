import { cookies } from "next/headers.js";
import { redirect } from "next/navigation";
import { getSession, getSessionWithRevocationCheck } from "@alga-psa/auth";
import { getTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale";
import { MspLayoutClient } from "./MspLayoutClient";
import { getCurrentTenantProduct } from "@/lib/productAccess";
import { getTenantDefaultCurrencyCode } from "@alga-psa/billing/actions/billingCurrencyActions";
import { preloadLocaleResources } from "@/lib/i18n/preloadLocaleResources";
import { isSelfHostLicensing } from "@alga-psa/licensing";
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// This template overrides the root layout's template for all /msp/* pages.
// The default includes the suffix because defaults bypass their own template
// (i.e. 'Dashboard | AlgaPSA' is rendered literally, not wrapped by the template).
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: {
      // '%s' is Next's own slot for the child route's title, not an i18next
      // placeholder — it passes through translation untouched.
      template: '%s | AlgaPSA',
      default: t('msp.layout.defaultTitle', { defaultValue: 'Dashboard | AlgaPSA' }),
    },
  };
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

  // Check if user is trying to access wrong portal
  if (session.user.user_type === 'client') {
    console.log('[msp-layout] Client user trying to access MSP portal, redirecting to switch prompt');
    redirect('/auth/msp/signin');
  }

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  let needsOnboarding = false;
  let onboardingResolvedServerSide = false;
  try {
    const tenantSettings = await getTenantSettings();
    if (tenantSettings) {
      needsOnboarding = !tenantSettings.onboarding_completed && !tenantSettings.onboarding_skipped;
      onboardingResolvedServerSide = true;
    }
  } catch (error) {
    console.error('Failed to load tenant settings for onboarding check:', error);
  }

  const locale = await getHierarchicalLocaleAction();
  const preloadedLocaleResources = await preloadLocaleResources(locale).catch(() => undefined);
  const productCode = await getCurrentTenantProduct();
  // Only self-host installs carry a license_state row; gate the trial/expiry
  // banner here so it never mounts (or calls getLicenseStatus) on hosted/SaaS.
  const selfHostLicensing = await isSelfHostLicensing();
  const currencyCode = await getTenantDefaultCurrencyCode().catch(() => 'USD');

  return (
    <MspLayoutClient
      session={session}
      currencyCode={currencyCode}
      productCode={productCode}
      needsOnboarding={needsOnboarding}
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
