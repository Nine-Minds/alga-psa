import type { Metadata } from "next";
import "./globals.css";
// Global vendor CSS for react-big-calendar is added via a <link> tag below
import { Toaster } from 'react-hot-toast';
import { getCurrentTenant } from "../lib/actions/tenantActions";
import { TenantProvider } from '@alga-psa/ui/components/providers/TenantProvider';
import { DynamicExtensionProvider } from '@alga-psa/ui/components/providers/DynamicExtensionProvider';
import { PostHogProvider } from '@alga-psa/ui/components/providers/PostHogProvider';
import { Theme } from '@radix-ui/themes';
import { ThemeProvider } from '../context/ThemeContext';
import { TagProvider } from '../context/TagContext';
import { ClientUIStateProvider } from '@alga-psa/ui/ui-reflection/ClientUIStateProvider';
import { I18nWrapper } from "@alga-psa/ui/lib/i18n/I18nWrapper";
import { getServerLocale } from "@alga-psa/ui/lib/i18n/server";
import { cookies, headers } from 'next/headers';
import { getTenantBrandingByDomain } from "../lib/actions/tenant-actions/getTenantBrandingByDomain";
import { generateBrandingStyles } from "../lib/branding/generateBrandingStyles";
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

// Removed Google Fonts to avoid network fetch during build
const inter = { className: "" } as const;

export const dynamic = 'force-dynamic';
//export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  // App initialization is now handled by instrumentation.ts
  return {
    title: "MSP Application",
    keywords: "MSP, Managed Service Provider, IT Services, Network Management, Cloud Services",
    authors: [{ name: "Nine Minds" }],
    description: "Managed Service Provider Application",
    icons: {
      icon: '/favicon.ico',
    },
    openGraph: {
      images: [
        {
          url: "/images/avatar-purple-background.png",
          width: 400,
          height: 400,
          alt: "AlgaPSA",
        },
      ],
    },
  };
}

async function MainContent({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  return (
    <TenantProvider tenant={tenant}>
      <MantineProvider>
        <ThemeProvider>
          <Theme>
            <DynamicExtensionProvider>
              <ClientUIStateProvider
                initialPageState={{
                  id: 'msp-application',
                  title: 'MSP Application',
                  components: []
                }}
              >
                {children}
              </ClientUIStateProvider>
            </DynamicExtensionProvider>
          </Theme>
        </ThemeProvider>
      </MantineProvider>
    </TenantProvider>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Check if this is a client portal route and inject branding styles
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const pathname = headersList.get('x-pathname')
    || headersList.get('x-middleware-pathname')
    || '';

  // Determine if we're on a client portal page
  const isClientPortal = pathname.includes('/client-portal') || pathname.includes('/auth/client-portal');

  let brandingStyles = '';
  if (isClientPortal) {
    const branding = await getTenantBrandingByDomain(host);
    // Use precomputed styles if available, otherwise generate them
    brandingStyles = branding?.computedStyles || generateBrandingStyles(branding);
  }

  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/react-big-calendar/lib/css/react-big-calendar.css" />
        <link rel="stylesheet" href="https://unpkg.com/@radix-ui/themes@3.2.0/styles.css" />
        {/* Inject client portal branding styles directly in head for immediate application */}
        {brandingStyles && (
          <style
            id="server-tenant-branding-styles"
            dangerouslySetInnerHTML={{ __html: brandingStyles }}
          />
        )}
      </head>
      <body className={`light`} suppressHydrationWarning>
        <PostHogProvider>
           <MainContent>{children}</MainContent>
          <Toaster position="top-right" />
        </PostHogProvider>
      </body>
    </html>
  );
}
