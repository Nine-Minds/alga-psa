"use client";
import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TenantProvider } from "@/components/TenantProvider";
import { ClientUIStateProvider } from "server/src/types/ui-reflection/ClientUIStateProvider";

/**
 * MSP Layout for Enterprise Edition
 * 
 * This layout provides the standard MSP interface (sidebar, header, main content)
 * for all MSP pages in the Enterprise Edition, including extension pages.
 * 
 * It ensures that extensions are rendered within the main application layout
 * rather than taking over the entire screen.
 */
export default function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppSessionProvider>
      <TenantProvider>
        <ClientUIStateProvider
          initialPageState={{ id: 'ee-msp', title: 'EE MSP', components: [] }}
        >
          <DefaultLayout>
            {children}
          </DefaultLayout>
        </ClientUIStateProvider>
      </TenantProvider>
    </AppSessionProvider>
  );
}
