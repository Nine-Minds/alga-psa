import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, getSessionWithRevocationCheck } from "@alga-psa/auth";
import { getTenantSettings } from "@alga-psa/tenancy/actions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";
import { featureFlags } from "@/lib/feature-flags/featureFlags";
import { MspLayoutClient } from "./MspLayoutClient";
import { registerSlaIntegration } from "@alga-psa/msp-composition/tickets/registerSlaIntegration";
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

// Register SLA service integrations (server-side, avoids bundling nodemailer into client)
registerSlaIntegration();

export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
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

  const isMspI18nEnabled = await featureFlags.isEnabled('msp-i18n-enabled', {
    userId: session.user.id,
    tenantId: session.user.tenant,
    userRole: session.user.user_type,
  });

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  let needsOnboarding = false;
  try {
    const tenantSettings = await getTenantSettings();
    if (tenantSettings) {
      needsOnboarding = !tenantSettings.onboarding_completed && !tenantSettings.onboarding_skipped;
    }
  } catch (error) {
    console.error('Failed to load tenant settings for onboarding check:', error);
  }

  const locale = isMspI18nEnabled ? await getHierarchicalLocaleAction() : null;

  return (
    <MspLayoutClient
      session={session}
      needsOnboarding={needsOnboarding}
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialLocale={locale}
      i18nEnabled={isMspI18nEnabled}
    >
      {children}
    </MspLayoutClient>
  );
}
