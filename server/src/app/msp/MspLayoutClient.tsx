"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";
import { PostHogUserIdentifier } from "server/src/components/PostHogUserIdentifier";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  needsOnboarding: boolean;
}

export function MspLayoutClient({ children, session, needsOnboarding }: Props) {
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
        {isOnboardingPage ? children : <DefaultLayout>{children}</DefaultLayout>}
      </TagProvider>
    </AppSessionProvider>
  );
}
