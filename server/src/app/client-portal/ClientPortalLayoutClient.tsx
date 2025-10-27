"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import ClientPortalLayout from "server/src/components/layout/ClientPortalLayout";
import { I18nWrapper } from "server/src/components/i18n/I18nWrapper";
import { PostHogUserIdentifier } from "server/src/components/PostHogUserIdentifier";
import { BrandingProvider } from "server/src/components/providers/BrandingProvider";
import type { Session } from "next-auth";
import type { TenantBranding } from "@product/actions/tenant-actions/tenantBrandingActions";
import type { SupportedLocale } from "server/src/lib/i18n/config";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  branding: TenantBranding | null;
  initialLocale?: SupportedLocale | null;
}

export function ClientPortalLayoutClient({ children, session, branding, initialLocale }: Props) {
  return (
    <AppSessionProvider session={session}>
      <PostHogUserIdentifier />
      <I18nWrapper portal="client" initialLocale={initialLocale || undefined}>
        <BrandingProvider initialBranding={branding}>
          <ClientPortalLayout>
            {children}
          </ClientPortalLayout>
        </BrandingProvider>
      </I18nWrapper>
    </AppSessionProvider>
  );
}
