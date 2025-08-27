"use client";
import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider"; 
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppSessionProvider>
      <ClientPortalLayout>
        {children}
      </ClientPortalLayout>
    </AppSessionProvider>
  );
}
