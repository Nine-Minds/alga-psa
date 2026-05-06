"use client";

import { AppSessionProvider } from "@alga-psa/auth/client";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TagProvider } from "@alga-psa/tags/context";
import { PostHogUserIdentifier } from "@alga-psa/ui/components/analytics/PostHogUserIdentifier";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import { I18nWrapper } from "@alga-psa/tenancy/components";
import { AIChatContextProvider } from '@product/chat/context';
import { TierProvider } from "@/context/TierContext";
import { ProductProvider } from "@/context/ProductContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Session } from "next-auth";
import type { SupportedLocale } from "@alga-psa/core/i18n/config";
import type { ProductCode } from '@alga-psa/types';
import { resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';
import { ProductRouteBoundary } from '@/components/product/ProductRouteBoundary';

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
      <ProductProvider>
        <TierProvider>
          <PostHogUserIdentifier />
          <TagProvider>
            <AIChatContextProvider>
              <ClientUIStateProvider
                initialPageState={{
                  id: 'msp-portal',
                  title: productCode === 'algadesk' ? 'Algadesk MSP' : 'MSP Portal',
                  components: []
                }}
              >
                {isOnboardingPage ? children : (
                  productCode === 'algadesk' ? (
                    routeBehavior === 'allowed' ? (
                      <div data-product-shell="algadesk">{children}</div>
                    ) : (
                      <ProductRouteBoundary behavior={routeBehavior} scope="msp" />
                    )
                  ) : (
                    <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>
                      {children}
                    </DefaultLayout>
                  )
                )}
              </ClientUIStateProvider>
            </AIChatContextProvider>
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
