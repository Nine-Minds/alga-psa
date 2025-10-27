import { getSession } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByTenantId } from "@product/actions/tenant-actions/getTenantBrandingByDomain";
import { getHierarchicalLocaleAction } from "@product/actions/locale-actions/getHierarchicalLocale";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

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
