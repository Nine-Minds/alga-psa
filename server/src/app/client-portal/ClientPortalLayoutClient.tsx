"use client";

import { AppSessionProvider } from "@alga-psa/auth/client";
import { ClientPortalLayout } from "@alga-psa/client-portal/components";
import { I18nWrapper } from "@alga-psa/ui/lib/i18n/I18nWrapper";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { BrandingProvider } from "@alga-psa/ui/components/providers/BrandingProvider";
import type { Session } from "next-auth";
import type { TenantBranding } from "server/src/lib/actions/tenant-actions/tenantBrandingActions";
import type { SupportedLocale } from "@alga-psa/ui/lib/i18n/config";

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
