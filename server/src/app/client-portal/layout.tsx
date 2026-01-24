import { redirect } from "next/navigation";
import { getSession, getSessionWithRevocationCheck } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "@alga-psa/tenancy/actions";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";

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

  return (
    <ClientPortalLayoutClient session={session} branding={branding} initialLocale={locale}>
      {children}
    </ClientPortalLayoutClient>
  );
}
