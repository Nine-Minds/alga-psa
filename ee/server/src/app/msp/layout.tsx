"use client";
import { SessionProvider } from "next-auth/react";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TenantProvider } from "server/src/components/TenantProvider";

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
    <SessionProvider>
      <TenantProvider>
        <DefaultLayout>
          {children}
        </DefaultLayout>
      </TenantProvider>
    </SessionProvider>
  );
}