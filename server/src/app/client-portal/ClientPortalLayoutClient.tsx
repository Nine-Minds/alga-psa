"use client";

import { AppSessionProvider } from "@alga-psa/auth/client";
import { ClientPortalLayout } from "@alga-psa/client-portal/components";
import { I18nWrapper } from "@alga-psa/tenancy/components";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { BrandingProvider } from "@alga-psa/tenancy/components";
import type { Session } from "next-auth";
import type { TenantBranding } from "@alga-psa/tenancy/actions";
import type { SupportedLocale } from "@alga-psa/core/i18n/config";
import type { ProductCode } from "@alga-psa/types";
import { ClientPortalDocumentsProvider } from "./ClientPortalDocumentsProvider";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  branding: TenantBranding | null;
  productCode: ProductCode;
  initialLocale?: SupportedLocale | null;
  initialSidebarCollapsed?: boolean;
}

export function ClientPortalLayoutClient({
  children,
  session,
  branding,
  productCode,
  initialLocale,
  initialSidebarCollapsed = false,
}: Props) {
  return (
    <AppSessionProvider session={session}>
      <PostHogUserIdentifier />
      <I18nWrapper portal="client" initialLocale={initialLocale || undefined}>
        <BrandingProvider initialBranding={branding}>
          <ClientPortalDocumentsProvider>
            <ClientPortalLayout
              productCode={productCode}
              initialSidebarCollapsed={initialSidebarCollapsed}
            >
              {children}
            </ClientPortalLayout>
          </ClientPortalDocumentsProvider>
        </BrandingProvider>
      </I18nWrapper>
    </AppSessionProvider>
  );
}
