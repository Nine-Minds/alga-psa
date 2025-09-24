"use client";
import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";
import { I18nWrapper } from "server/src/components/i18n/I18nWrapper";
import { PostHogUserIdentifier } from "server/src/components/PostHogUserIdentifier";
import { BrandingProvider } from "server/src/components/providers/BrandingProvider";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppSessionProvider>
      <PostHogUserIdentifier />
      <I18nWrapper portal="client">
        <BrandingProvider>
          <ClientPortalLayout>
            {children}
          </ClientPortalLayout>
        </BrandingProvider>
      </I18nWrapper>
    </AppSessionProvider>
  );
}
