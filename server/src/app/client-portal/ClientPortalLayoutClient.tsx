"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";
import { I18nWrapper } from "server/src/components/i18n/I18nWrapper";
import { PostHogUserIdentifier } from "server/src/components/PostHogUserIdentifier";
import { BrandingProvider } from "server/src/components/providers/BrandingProvider";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
}

export function ClientPortalLayoutClient({ children, session }: Props) {
  return (
    <AppSessionProvider session={session}>
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
