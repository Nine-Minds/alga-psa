import { cookies } from "next/headers.js";
import { redirect } from "next/navigation";
import { getSession, getSessionWithRevocationCheck } from "@alga-psa/auth";
import { getTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale";
import { MspLayoutClient } from "./MspLayoutClient";
import { getCurrentTenantProduct } from "@/lib/productAccess";
import { preloadLocaleResources } from "@/lib/i18n/preloadLocaleResources";
import { isSelfHostLicensing } from "@alga-psa/licensing";
import type { Metadata } from 'next';

// This template overrides the root layout's template for all /msp/* pages.
// The default includes the suffix because defaults bypass their own template
// (i.e. 'Dashboard | Alga PSA' is rendered literally, not wrapped by the template).
export const metadata: Metadata = {
  title: {
    template: '%s | Alga PSA',
    default: 'Dashboard | Alga PSA',
  },
};

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

  return (
    <MspLayoutClient
      session={session}
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
