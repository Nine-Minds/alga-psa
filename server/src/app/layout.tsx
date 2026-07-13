import type { Metadata } from "next";
import "./globals.css";
import "./print.css";
// Global vendor CSS for react-big-calendar is added via a <link> tag below
import { ThemedToaster } from '@alga-psa/ui/components/ThemedToaster';
// Granular action imports: the /actions barrel would pull every tenancy 'use server'
// file into every route's server-reference manifest (dev OOM — see package-build-system.md).
import { getCurrentTenant } from '@alga-psa/tenancy/actions/coreTenantActions';
import { getTenantBrandingByDomain } from '@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain';
import { TenantProvider } from '@alga-psa/ui/components/providers/TenantProvider';
import { DynamicExtensionProvider } from '@alga-psa/ui/components/providers/DynamicExtensionProvider';
import { PostHogProvider } from '@/components/providers/PostHogProvider';
import { AppThemeProvider } from '@/components/providers/AppThemeProvider';
import { ThemeBridge } from '@/components/providers/ThemeBridge';
import { ClientUIStateProvider } from '@alga-psa/ui/ui-reflection/ClientUIStateProvider';
import { getServerLocale } from "@alga-psa/ui/lib/i18n/serverOnly";
import { cookies, headers } from 'next/headers.js';
import { generateBrandingStyles } from "@alga-psa/tenancy";
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { resolveRequestHost, resolveRequestOrigin } from '@/lib/deployment/requestHost';
import '@mantine/core/styles.css';
import 'reactflow/dist/style.css';
// Loaded last so the Inter font-token overrides win over Mantine/Radix defaults.
import './font-overrides.css';

// Self-hosted Inter (variable) — no build-time network fetch (font files live
// in ./fonts and are read locally by next/font/local).
import localFont from 'next/font/local';
const inter = localFont({
  src: [
    { path: './fonts/InterVariable.woff2', style: 'normal', weight: '100 900' },
    { path: './fonts/InterVariable-Italic.woff2', style: 'italic', weight: '100 900' },
  ],
  variable: '--font-inter',
  display: 'swap',
});
// Self-hosted JetBrains Mono (variable) for tabular/number figures.
const jetbrainsMono = localFont({
  src: [{ path: './fonts/JetBrainsMono.woff2', style: 'normal', weight: '100 800' }],
  variable: '--font-mono',
  display: 'swap',
});

export const dynamic = 'force-dynamic';
//export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const request = { headers: headersList };
  const caps = resolveDeploymentCapabilities();
  const host = resolveRequestHost(request, caps).hostHeader || 'localhost:3010';
  const metadataBase = resolveRequestOrigin(request, caps, {
    fallbackHost: 'localhost:3010',
    fallbackProto: host.includes('localhost') ? 'http' : 'https',
  });

  return {
    metadataBase,
    title: {
      template: '%s | Alga PSA',
      default: 'Alga PSA',
    },
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
      <AppThemeProvider>
        <ThemeBridge>
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
          <ThemedToaster />
        </ThemeBridge>
      </AppThemeProvider>
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className}`} suppressHydrationWarning>
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
      <body className={`${inter.className} ${inter.variable}`} suppressHydrationWarning>
        <PostHogProvider>
           <MainContent>{children}</MainContent>
        </PostHogProvider>
      </body>
    </html>
  );
}
