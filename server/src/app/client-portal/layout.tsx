"use client";
import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";
import { I18nWrapper } from "../../components/I18nWrapper";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppSessionProvider>
      <I18nWrapper portal="client">
        <ClientPortalLayout>
          {children}
        </ClientPortalLayout>
      </I18nWrapper>
    </AppSessionProvider>
  );
}
