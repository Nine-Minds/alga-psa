import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionWithRevocationCheck } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "server/src/lib/actions/tenant-actions/getTenantBrandingByDomain";
import { getHierarchicalLocaleAction } from "server/src/lib/actions/locale-actions/getHierarchicalLocale";
import { getSessionCookieConfig } from "server/src/lib/auth/sessionCookies";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use the full auth with revocation checks in the layout
  // This ensures revoked sessions are caught on every page navigation
  const session = await getSessionWithRevocationCheck();

  // If session is null (either not logged in or revoked), clear cookie and redirect
  if (!session) {
    const cookieStore = await cookies();
    const sessionCookieConfig = getSessionCookieConfig();
    const hasCookie = cookieStore.has(sessionCookieConfig.name);

    if (hasCookie) {
      // Had a cookie but session is null - likely revoked
      console.log('[client-portal-layout] Session invalid or revoked, clearing cookie');
      cookieStore.delete(sessionCookieConfig.name);
      redirect('/auth/client-portal/signin?error=SessionRevoked');
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
