import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, getSessionWithRevocationCheck } from "@alga-psa/auth";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "@alga-psa/tenancy/actions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";
import type { Metadata } from 'next';

const CLIENT_SIDEBAR_COOKIE = 'client_portal_sidebar_collapsed';

// This template overrides the root layout's template for all /client-portal/* pages.
// The default includes the suffix because defaults bypass their own template.
export const metadata: Metadata = {
  title: {
    template: '%s | Client Portal',
    default: 'Dashboard | Client Portal',
  },
};

export default async function Layout({
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
    console.log('[client-portal-layout] No session found, redirecting to signin');
    redirect('/auth/client-portal/signin');
  }

  // Check if user is trying to access wrong portal
  if (session.user.user_type === 'internal') {
    console.log('[client-portal-layout] MSP user trying to access client portal, redirecting to switch prompt');
    redirect('/auth/client-portal/signin');
  }

  // Get branding from session tenant (no host header needed!)
  const branding = session?.user?.tenant
    ? await getTenantBrandingByTenantId(session.user.tenant)
    : null;

  // Get hierarchical locale on server (user -> client -> tenant -> system)
  // This eliminates the need for client-side async fetch and loading state
  const locale = await getHierarchicalLocaleAction();

  // Read sidebar collapsed state from cookie so the first paint matches user preference.
  const cookieStore = await cookies();
  const initialSidebarCollapsed =
    cookieStore.get(CLIENT_SIDEBAR_COOKIE)?.value === 'true';

  return (
    <ClientPortalLayoutClient
      session={session}
      branding={branding}
      initialLocale={locale}
      initialSidebarCollapsed={initialSidebarCollapsed}
    >
      {children}
    </ClientPortalLayoutClient>
  );
}
