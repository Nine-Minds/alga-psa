import { cookies } from "next/headers.js";
import { getSession } from "@alga-psa/auth";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";
import { MspLayoutClient } from "./MspLayoutClient";
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// This template overrides the root layout's template for all /msp/* pages.
// The default includes the suffix because defaults bypass their own template.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: {
      // '%s' is Next's own slot for the child route's title, not an i18next
      // placeholder — it passes through translation untouched.
      template: '%s | AlgaPSA',
      default: t('msp.layout.defaultTitle', { defaultValue: 'Dashboard | AlgaPSA' }),
    },
  };
}

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
  const locale = await getHierarchicalLocaleAction();
  return (
    <MspLayoutClient
      session={session}
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialLocale={locale}
    >
      {children}
    </MspLayoutClient>
  );
}
