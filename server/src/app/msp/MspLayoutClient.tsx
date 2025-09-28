"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";
import { OnboardingProvider } from "server/src/components/onboarding/OnboardingProvider";
import { PostHogUserIdentifier } from "server/src/components/PostHogUserIdentifier";
import { usePathname } from "next/navigation";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
}

export function MspLayoutClient({ children, session }: Props) {
  const pathname = usePathname();
  const isOnboardingPage = pathname === "/msp/onboarding";

  return (
    <AppSessionProvider session={session}>
      <PostHogUserIdentifier />
      <TagProvider>
        <OnboardingProvider>
          {isOnboardingPage ? children : <DefaultLayout>{children}</DefaultLayout>}
        </OnboardingProvider>
      </TagProvider>
    </AppSessionProvider>
  );
}
