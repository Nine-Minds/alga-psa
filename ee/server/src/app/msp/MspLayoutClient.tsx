"use client";

import { AppSessionProvider } from "@alga-psa/auth/components/AppSessionProvider";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TenantProvider } from "@alga-psa/ui/components/providers/TenantProvider";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import type { Session } from "next-auth";
import { I18nWrapper } from "@alga-psa/tenancy/components";
import type { SupportedLocale } from "@alga-psa/ui/lib/i18n/config";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  initialSidebarCollapsed: boolean;
  initialLocale?: SupportedLocale | null;
  i18nEnabled: boolean;
}

export function MspLayoutClient({
  children,
  session,
  initialSidebarCollapsed,
  initialLocale,
  i18nEnabled
}: Props) {
  const content = (
    <AppSessionProvider session={session}>
      <TenantProvider>
        <ClientUIStateProvider
          initialPageState={{ id: 'ee-msp', title: 'EE MSP', components: [] }}
        >
          <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>
            {children}
          </DefaultLayout>
        </ClientUIStateProvider>
      </TenantProvider>
    </AppSessionProvider>
  );

  if (!i18nEnabled) {
    return content;
  }

  return (
    <I18nWrapper portal="msp" initialLocale={initialLocale || undefined}>
      {content}
    </I18nWrapper>
  );
}
