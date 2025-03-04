"use client";
import { SessionProvider } from "next-auth/react"; 
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionProvider>
      <ClientPortalLayout>
        {children}
      </ClientPortalLayout>
    </SessionProvider>
  );
}
