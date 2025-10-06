import { getSession } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";
import { getTenantBrandingByDomain } from "server/src/lib/actions/tenant-actions/getTenantBrandingByDomain";
import { headers } from "next/headers";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  // Get branding based on current domain (styles are injected in root layout)
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const branding = await getTenantBrandingByDomain(host);
  // Don't pass initialLocale - let I18nWrapper use getHierarchicalLocaleAction
  // which checks user preference -> client preference -> tenant preference -> system default

  return (
    <ClientPortalLayoutClient session={session} branding={branding} initialLocale={null}>
      {children}
    </ClientPortalLayoutClient>
  );
}
