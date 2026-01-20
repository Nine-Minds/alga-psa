"use client";

import { AppSessionProvider } from "@alga-psa/auth/client";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  needsOnboarding: boolean;
  initialSidebarCollapsed: boolean;
}

export function MspLayoutClient({ children, session, needsOnboarding, initialSidebarCollapsed }: Props) {
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

  return (
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
          {isOnboardingPage ? children : <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>{children}</DefaultLayout>}
        </ClientUIStateProvider>
      </TagProvider>
    </AppSessionProvider>
  );
}
