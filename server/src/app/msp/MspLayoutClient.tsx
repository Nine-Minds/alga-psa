"use client";

import { AppSessionProvider } from "@alga-psa/auth/client";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TagProvider } from "@alga-psa/tags/context";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import { I18nWrapper } from "@alga-psa/tenancy/components";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Session } from "next-auth";
import type { SupportedLocale } from "@alga-psa/core/i18n/config";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  needsOnboarding: boolean;
  initialSidebarCollapsed: boolean;
  initialLocale?: SupportedLocale | null;
  i18nEnabled: boolean;
}

export function MspLayoutClient({
  children,
  session,
  needsOnboarding,
  initialSidebarCollapsed,
  initialLocale,
  i18nEnabled
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnboardingPage = pathname === "/msp/onboarding";

  useEffect(() => {
    if (needsOnboarding && !isOnboardingPage) {
      router.replace("/msp/onboarding");
    }
  }, [needsOnboarding, isOnboardingPage, router]);

  if (needsOnboarding && !isOnboardingPage) {
    return null;
  }

  const content = (
    <AppSessionProvider session={session}>
      <PostHogUserIdentifier />
      <TagProvider>
        <ClientUIStateProvider
          initialPageState={{
            id: 'msp-portal',
            title: 'MSP Portal',
            components: []
          }}
        >
          {isOnboardingPage ? children : (
            <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>
              {children}
            </DefaultLayout>
          )}
        </ClientUIStateProvider>
      </TagProvider>
    </AppSessionProvider>
  );

  if (!i18nEnabled) {
    return content;
  }

  return (
    <I18nWrapper portal="msp" initialLocale={initialLocale || undefined} showPseudoLocales={i18nEnabled}>
      {content}
    </I18nWrapper>
  );
}
