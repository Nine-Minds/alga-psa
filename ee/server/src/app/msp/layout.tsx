import { cookies } from "next/headers";
import { getSession } from "@alga-psa/auth";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";
import { featureFlags } from "server/src/lib/feature-flags/featureFlags";
import { MspLayoutClient } from "./MspLayoutClient";

/**
 * MSP Layout for Enterprise Edition
 * 
 * This layout provides the standard MSP interface (sidebar, header, main content)
 * for all MSP pages in the Enterprise Edition, including extension pages.
 * 
 * It ensures that extensions are rendered within the main application layout
 * rather than taking over the entire screen.
 */
export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  const isMspI18nEnabled = await featureFlags.isEnabled('msp-i18n-enabled', {
    userId: session?.user?.id,
    tenantId: session?.user?.tenant,
    userRole: session?.user?.user_type,
  });
  const locale = isMspI18nEnabled ? await getHierarchicalLocaleAction() : null;
  return (
    <MspLayoutClient
      session={session}
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialLocale={locale}
      i18nEnabled={isMspI18nEnabled}
    >
      {children}
    </MspLayoutClient>
  );
}
