"use client";

import React from "react";
import { AppSessionProvider } from "@alga-psa/auth/client";
import DefaultLayout from "@/components/layout/DefaultLayout";
import AlgaDeskMspShell from "@/components/layout/AlgaDeskMspShell";
import { TagProvider } from "@alga-psa/tags/context";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import { I18nWrapper } from "@alga-psa/tenancy/components";
import { getTenantSettings } from "@alga-psa/tenancy/actions";
import { AIChatContextProvider } from '@product/chat/context';
import { TierProvider } from "@/context/TierContext";
import { ProductProvider } from "@/context/ProductContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "next-auth";
import type { SupportedLocale } from "@alga-psa/core/i18n/config";
import type { ProductCode } from '@alga-psa/types';
import { resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';
import { ProductRouteBoundary } from '@/components/product/ProductRouteBoundary';
import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts';
import { useKeyboardShortcutPreferenceStorage } from '@/hooks/useKeyboardShortcutPreferenceStorage';

interface Props {
  children: React.ReactNode;
  session: Session | null;
  productCode: ProductCode;
  needsOnboarding: boolean;
  initialSidebarCollapsed: boolean;
  initialLocale?: SupportedLocale | null;
}

export function MspLayoutClient({
  children,
  session,
  productCode,
  needsOnboarding,
  initialSidebarCollapsed,
  initialLocale,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnboardingPage = pathname === "/msp/onboarding";
  const routeBehavior = resolveProductRouteBehavior(productCode, pathname);
  const sessionTenant = session?.user?.tenant;
  const shortcutPreference = useKeyboardShortcutPreferenceStorage({ userId: session?.user?.id });
  const [clientNeedsOnboarding, setClientNeedsOnboarding] = useState(false);
  const shouldForceOnboarding = needsOnboarding || clientNeedsOnboarding;

  useEffect(() => {
    if (shouldForceOnboarding && !isOnboardingPage) {
      router.replace("/msp/onboarding");
    }
  }, [shouldForceOnboarding, isOnboardingPage, router]);

  useEffect(() => {
    let isCancelled = false;

    setClientNeedsOnboarding(false);

    if (needsOnboarding || isOnboardingPage || !sessionTenant) {
      return () => {
        isCancelled = true;
      };
    }

    void getTenantSettings()
      .then((settings) => {
        if (isCancelled || !settings) {
          return;
        }

        const hasOnboardingFlags =
          Object.prototype.hasOwnProperty.call(settings, 'onboarding_completed') &&
          Object.prototype.hasOwnProperty.call(settings, 'onboarding_skipped');

        if (hasOnboardingFlags && !settings.onboarding_completed && !settings.onboarding_skipped) {
          setClientNeedsOnboarding(true);
          router.replace('/msp/onboarding');
        }
      })
      .catch((error) => {
        console.error('Error checking onboarding status:', error);
      });

    return () => {
      isCancelled = true;
    };
  }, [needsOnboarding, isOnboardingPage, sessionTenant, router]);

  if (shouldForceOnboarding && !isOnboardingPage) {
    return null;
  }

  const isAlgaDesk = productCode === 'algadesk';

  const content = (
    <AppSessionProvider session={session}>
      <ProductProvider>
        <TierProvider>
          <PostHogUserIdentifier />
          <TagProvider>
            <ClientUIStateProvider
              initialPageState={{
                id: 'msp-portal',
                title: isAlgaDesk ? 'AlgaDesk MSP' : 'MSP Portal',
                components: []
              }}
            >
              {isOnboardingPage ? children : (
                <KeyboardShortcutsProvider
                  routeKey={pathname ?? '/msp'}
                  storage={shortcutPreference.storage}
                  onConflict={({ binding, actionIds }) => {
                    if (process.env.NODE_ENV !== 'production') {
                      console.warn(
                        `[keyboard-shortcuts] "${binding}" is bound to multiple actions and was ignored: ${actionIds.join(', ')}`,
                      );
                    }
                  }}
                >
                  {isAlgaDesk ? (
                    routeBehavior === 'allowed' ? (
                      <AlgaDeskMspShell initialSidebarCollapsed={initialSidebarCollapsed}>
                        {children}
                      </AlgaDeskMspShell>
                    ) : (
                      <ProductRouteBoundary behavior={routeBehavior} scope="msp" />
                    )
                  ) : (
                    <AIChatContextProvider>
                      <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>
                        {children}
                      </DefaultLayout>
                    </AIChatContextProvider>
                  )
                  }
                </KeyboardShortcutsProvider>
              )}
            </ClientUIStateProvider>
          </TagProvider>
        </TierProvider>
      </ProductProvider>
    </AppSessionProvider>
  );

  return (
    <I18nWrapper portal="msp" initialLocale={initialLocale || undefined}>
      {content}
    </I18nWrapper>
  );
}
