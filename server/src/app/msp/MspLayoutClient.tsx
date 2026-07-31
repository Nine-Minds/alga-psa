"use client";

import React from "react";
import { AppSessionProvider } from "@alga-psa/auth/client";
import DefaultLayout from "@/components/layout/DefaultLayout";
import AlgaDeskMspShell from "@/components/layout/AlgaDeskMspShell";
import { TagProvider } from "@alga-psa/tags/context";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import { I18nWrapper } from "@alga-psa/tenancy/components/i18n/I18nWrapper";
import { getTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { AIChatContextProvider } from '@product/chat/context';
import { TierProvider } from "@/context/TierContext";
import LicenseBanner from "@/components/licenses/LicenseBanner";
import { ProductProvider } from "@/context/ProductContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "next-auth";
import type { SupportedLocale } from "@alga-psa/core/i18n/config";
import type { ProductCode } from '@alga-psa/types';
import { resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';
import { ProductRouteBoundary } from '@/components/product/ProductRouteBoundary';
import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { useKeyboardShortcutPreferenceStorage } from '@/hooks/useKeyboardShortcutPreferenceStorage';

interface Props {
  children: React.ReactNode;
  session: Session | null;
  /** Tenant default currency (default_billing_settings) for CurrencyFormatProvider. */
  currencyCode?: string;
  productCode: ProductCode;
  needsOnboarding: boolean;
  initialSidebarCollapsed: boolean;
  initialLocale?: SupportedLocale | null;
  /** Server-embedded i18n resources for the route (skips per-namespace HTTP fetches). */
  preloadedLocaleResources?: Record<string, Record<string, unknown>>;
  /**
   * True when the server authoritatively resolved onboarding status from tenant
   * settings this request. Lets the client skip its defensive re-fetch of
   * getTenantSettings (the server value already drives `needsOnboarding`).
   */
  onboardingResolvedServerSide?: boolean;
  /** Self-host install (license_state row present). Hosted/SaaS = false. */
  selfHostLicensing?: boolean;
}

function OnboardingRedirectFallback() {
  const { t } = useTranslation('msp/core');

  return (
    <div className="flex min-h-screen items-center justify-center bg-[rgb(var(--color-background))] px-6">
      <div className="max-w-md text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[rgb(var(--color-border-300))] border-t-[rgb(var(--color-primary-500))]" />
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('onboardingRedirect.title')}
        </h1>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-600))]">
          {t('onboardingRedirect.description')}
        </p>
        <a
          id="msp-onboarding-redirect-fallback-link"
          href="/msp/onboarding"
          className="mt-4 inline-flex text-sm font-medium text-[rgb(var(--color-primary-600))] underline-offset-4 hover:underline"
        >
          {t('onboardingRedirect.action')}
        </a>
      </div>
    </div>
  );
}

export function MspLayoutClient({
  children,
  session,
  currencyCode,
  productCode,
  needsOnboarding,
  initialSidebarCollapsed,
  initialLocale,
  preloadedLocaleResources,
  onboardingResolvedServerSide = false,
  selfHostLicensing = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnboardingPage = pathname === "/msp/onboarding";
  const routeBehavior = resolveProductRouteBehavior(productCode, pathname);
  const sessionTenant = session?.user?.tenant;
  const shortcutPreference = useKeyboardShortcutPreferenceStorage({ userId: session?.user?.id });
  const [clientNeedsOnboarding, setClientNeedsOnboarding] = useState(false);
  const [clientOnboardingCheckComplete, setClientOnboardingCheckComplete] = useState(false);
  const shouldForceOnboarding = needsOnboarding || clientNeedsOnboarding;
  const canShowLicenseBanner =
    selfHostLicensing &&
    !isOnboardingPage &&
    !shouldForceOnboarding &&
    clientOnboardingCheckComplete;

  useEffect(() => {
    if (shouldForceOnboarding && !isOnboardingPage) {
      router.replace("/msp/onboarding");
    }
  }, [shouldForceOnboarding, isOnboardingPage, router]);

  useEffect(() => {
    let isCancelled = false;

    setClientNeedsOnboarding(false);
    // The server already resolved onboarding from tenant settings; trust it and
    // skip the client re-fetch (avoids a getTenantSettings round-trip on load).
    setClientOnboardingCheckComplete(onboardingResolvedServerSide);

    if (onboardingResolvedServerSide || needsOnboarding || isOnboardingPage || !sessionTenant) {
      return () => {
        isCancelled = true;
      };
    }

    void getTenantSettings()
      .then((settings) => {
        if (isCancelled) {
          return;
        }

        if (!settings) {
          setClientOnboardingCheckComplete(true);
          return;
        }

        const hasOnboardingFlags =
          Object.prototype.hasOwnProperty.call(settings, 'onboarding_completed') &&
          Object.prototype.hasOwnProperty.call(settings, 'onboarding_skipped');

        if (hasOnboardingFlags && !settings.onboarding_completed && !settings.onboarding_skipped) {
          setClientNeedsOnboarding(true);
          router.replace('/msp/onboarding');
          return;
        }

        setClientOnboardingCheckComplete(true);
      })
      .catch((error) => {
        console.error('Error checking onboarding status:', error);
        if (!isCancelled) {
          setClientOnboardingCheckComplete(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [needsOnboarding, isOnboardingPage, sessionTenant, router]);

  const isAlgaDesk = productCode === 'algadesk';

  const content = shouldForceOnboarding && !isOnboardingPage ? (
    <OnboardingRedirectFallback />
  ) : (
    <AppSessionProvider session={session}>
      <ProductProvider>
        <TierProvider selfHostLicensing={selfHostLicensing}>
          {canShowLicenseBanner && <LicenseBanner />}
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
    <I18nWrapper portal="msp" initialLocale={initialLocale || undefined} preloadedResources={preloadedLocaleResources}>
      <CurrencyFormatProvider currencyCode={currencyCode || 'USD'}>
        {content}
      </CurrencyFormatProvider>
    </I18nWrapper>
  );
}
