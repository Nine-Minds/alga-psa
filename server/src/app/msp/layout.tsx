"use client";
import { SessionProvider } from "next-auth/react";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";
import { OnboardingProvider } from "server/src/components/onboarding/OnboardingProvider";

export default function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionProvider>
      <TagProvider>
        <OnboardingProvider>
          <DefaultLayout>
            {children}
          </DefaultLayout>
        </OnboardingProvider>
      </TagProvider>
    </SessionProvider>
  );
}
