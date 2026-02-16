import type { Metadata } from "next";
import "./globals.css";
// Global vendor CSS for react-big-calendar is added via a <link> tag below
import { ThemedToaster } from '@alga-psa/ui/components/ThemedToaster';
import { getCurrentTenant, getTenantBrandingByDomain } from '@alga-psa/tenancy/actions';
import { TenantProvider } from '@alga-psa/ui/components/providers/TenantProvider';
import { DynamicExtensionProvider } from '@alga-psa/ui/components/providers/DynamicExtensionProvider';
import { PostHogProvider } from '@/components/providers/PostHogProvider';
import { AppThemeProvider } from '@/components/providers/AppThemeProvider';
import { ThemeBridge } from '@/components/providers/ThemeBridge';
import { ClientUIStateProvider } from '@alga-psa/ui/ui-reflection/ClientUIStateProvider';
import { getServerLocale } from "@alga-psa/ui/lib/i18n/serverOnly";
import { cookies, headers } from 'next/headers';
import { generateBrandingStyles } from "@alga-psa/tenancy";
import '@mantine/core/styles.css';
import 'reactflow/dist/style.css';

// Removed Google Fonts to avoid network fetch during build
const inter = { className: "" } as const;

export const dynamic = 'force-dynamic';
//export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3010';
  const proto =
    headersList.get('x-forwarded-proto') ||
    (host.includes('localhost') ? 'http' : 'https');
  const metadataBase = new URL(`${proto}://${host}`);

  return {
    metadataBase,
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

async function MainContent({ children, forcedTheme }: { children: React.ReactNode; forcedTheme?: string }) {
  const tenant = await getCurrentTenant();
  return (
    <TenantProvider tenant={tenant}>
      <AppThemeProvider forcedTheme={forcedTheme}>
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

  // Force light theme on auth pages — dark mode is feature-flagged and
  // should never appear to unauthenticated users.
  const isAuthRoute = pathname.includes('/auth/');
  const forcedTheme = isAuthRoute ? 'light' : undefined;

  let brandingStyles = '';
  if (isClientPortal) {
    const branding = await getTenantBrandingByDomain(host);
    // Use precomputed styles if available, otherwise generate them
    brandingStyles = branding?.computedStyles || generateBrandingStyles(branding);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Force light theme on auth pages. next-themes' blocking script
            (rendered in <body>) reads localStorage('theme') to set the <html>
            class. We temporarily swap the stored value to 'light' so the
            blocking script applies light mode, then restore the real preference
            so it isn't lost for authenticated pages. */}
        <script
          dangerouslySetInnerHTML={{ __html: `(function(){if(/^\\/auth\\//.test(window.location.pathname)){try{var k='theme',p=localStorage.getItem(k);localStorage.setItem(k,'light');setTimeout(function(){if(p!==null)localStorage.setItem(k,p);else localStorage.removeItem(k)},0)}catch(e){}}})()` }}
        />
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
      <body className={inter.className} suppressHydrationWarning>
        <PostHogProvider>
           <MainContent forcedTheme={forcedTheme}>{children}</MainContent>
        </PostHogProvider>
      </body>
    </html>
  );
}
