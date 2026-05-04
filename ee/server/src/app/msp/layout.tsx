import { cookies } from "next/headers.js";
import { getSession } from "@alga-psa/auth";
import { getHierarchicalLocaleAction } from "@alga-psa/tenancy/actions";
import { MspLayoutClient } from "./MspLayoutClient";
import type { Metadata } from 'next';

// This template overrides the root layout's template for all /msp/* pages.
// The default includes the suffix because defaults bypass their own template.
export const metadata: Metadata = {
  title: {
    template: '%s | Alga PSA',
    default: 'Dashboard | Alga PSA',
  },
};

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
