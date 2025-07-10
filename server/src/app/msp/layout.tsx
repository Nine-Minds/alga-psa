"use client";
import { SessionProvider } from "next-auth/react";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";
import { OnboardingProvider } from "server/src/components/onboarding/OnboardingProvider";
import { usePathname } from 'next/navigation';

export default function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const isOnboardingPage = pathname === '/msp/onboarding';

  return (
    <SessionProvider>
      <TagProvider>
        <OnboardingProvider>
          {isOnboardingPage ? (
            children
          ) : (
            <DefaultLayout>
              {children}
            </DefaultLayout>
          )}
        </OnboardingProvider>
      </TagProvider>
    </SessionProvider>
  );
}
