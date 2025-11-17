import { redirect } from "next/navigation";
import { getSession } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "server/src/lib/actions/tenant-actions/getTenantBrandingByDomain";
import { getHierarchicalLocaleAction } from "server/src/lib/actions/locale-actions/getHierarchicalLocale";
import { UserSession } from "server/src/lib/models/UserSession";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  // Check if session has been revoked (force logout on every page load)
  if (session?.session_id && session?.user?.tenant) {
    try {
      const isRevoked = await UserSession.isRevoked(
        session.user.tenant,
        (session as any).session_id
      );

      if (isRevoked) {
        console.log('[client-portal-layout] Session revoked, redirecting to signin:', (session as any).session_id);
        redirect('/auth/client-portal/signin?error=SessionRevoked');
      }
    } catch (error) {
      console.error('[client-portal-layout] Session revocation check failed:', error);
      // Don't block on errors
    }
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
