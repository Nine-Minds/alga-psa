import { redirect } from "next/navigation";
import { getSessionWithRevocationCheck } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "server/src/lib/actions/tenant-actions/getTenantBrandingByDomain";
import { getHierarchicalLocaleAction } from "server/src/lib/actions/locale-actions/getHierarchicalLocale";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use the full auth with revocation checks in the layout
  // This ensures revoked sessions are caught on every page navigation
  const session = await getSessionWithRevocationCheck();

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
