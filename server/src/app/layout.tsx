import type { Metadata } from "next";
import "./globals.css";
import "./print.css";
// Global vendor CSS for react-big-calendar is added via a <link> tag below
import { ThemedToaster } from '@alga-psa/ui/components/ThemedToaster';
// Granular action imports: the /actions barrel would pull every tenancy 'use server'
// file into every route's server-reference manifest (dev OOM — see package-build-system.md).
import { getCurrentTenant } from '@alga-psa/tenancy/actions/coreTenantActions';
import {
  getTenantBrandingByDomain,
  getTenantBrandingByTenantId,
  getTenantThemeByDomain,
} from '@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain';
import { getTenantThemeByTenantId } from '@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions';
import { DEFAULT_TENANT_THEME } from '@alga-psa/tenancy/lib/tenantTheme';
import { generateCustomThemeStyles } from '@alga-psa/tenancy/lib/customTheme';
import { isEnterprise } from '@alga-psa/core/features';
import { TenantProvider } from '@alga-psa/ui/components/providers/TenantProvider';
import { DynamicExtensionProvider } from '@alga-psa/ui/components/providers/DynamicExtensionProvider';
import { PostHogProvider } from '@/components/providers/PostHogProvider';
import { AppThemeProvider } from '@/components/providers/AppThemeProvider';
import { ThemeBridge } from '@/components/providers/ThemeBridge';
import { ClientUIStateProvider } from '@alga-psa/ui/ui-reflection/ClientUIStateProvider';
import { getServerLocale, getServerTranslation, registerServerLocaleResolver } from "@alga-psa/ui/lib/i18n/serverOnly";
import { getHierarchicalLocaleAction } from '@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale';
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

// instrumentation.ts registers this too, but it is compiled into a different
// webpack layer than server rendering, so the module-level singleton it sets is
// invisible to `getServerLocale()`. Registering here puts the resolver in the
// RSC layer's copy — the root layout is in every route's module graph. Without
// it `getServerLocale()` reaches no caller-supplied options either, so the DB
// hierarchy is skipped entirely and every server-rendered string falls back to
// the browser's Accept-Language.
registerServerLocaleResolver(() => getHierarchicalLocaleAction());

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const request = { headers: headersList };
  const caps = resolveDeploymentCapabilities();
  const host = resolveRequestHost(request, caps).hostHeader || 'localhost:3010';
  const metadataBase = resolveRequestOrigin(request, caps, {
    fallbackHost: 'localhost:3010',
    fallbackProto: host.includes('localhost') ? 'http' : 'https',
  });
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    metadataBase,
    title: {
      template: '%s | AlgaPSA',
      default: 'AlgaPSA',
    },
    keywords: t('app.keywords', {
      defaultValue: 'MSP, Managed Service Provider, IT Services, Network Management, Cloud Services',
    }),
    authors: [{ name: "Nine Minds" }],
    description: t('app.description', { defaultValue: 'Managed Service Provider Application' }),
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

function MainContent({ children, tenant }: { children: React.ReactNode; tenant: string | null }) {
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

  const tenant = await getCurrentTenant();

  let brandingStyles = '';
  if (isClientPortal) {
    const branding = await getTenantBrandingByDomain(host);
    // Use precomputed styles if available, otherwise generate them
    brandingStyles = branding?.computedStyles || generateBrandingStyles(branding);
  }

  // The theme pair is tenant-wide, so it has to resolve on every surface: from
  // the session when someone is signed in, from the request host otherwise
  // (same vanity-domain lookup portal branding already uses).
  const theme = isEnterprise
    ? tenant
      ? await getTenantThemeByTenantId(tenant)
      : isClientPortal
        ? await getTenantThemeByDomain(host)
        : DEFAULT_TENANT_THEME
    : DEFAULT_TENANT_THEME;

  const customThemeStyles = theme.pairId === 'custom' && theme.customTheme
    ? theme.customTheme.computedStyles || generateCustomThemeStyles(theme.customTheme)
    : '';

  // Enterprise white-label: the MSP shell wears the tenant's brand colors too,
  // but only once an admin has opted in — an existing portal-only branding
  // configuration must not repaint the staff-facing app on its own.
  if (!isClientPortal && tenant && isEnterprise && theme.mspWhiteLabel) {
    const branding = await getTenantBrandingByTenantId(tenant);
    // The cached computedStyles belong to the portal (and are empty once the
    // portal opts into the theme), so the MSP shell builds its own copy.
    brandingStyles = generateBrandingStyles(branding, { surface: 'msp' });
  }

  // Drives screen-reader pronunciation, browser translation prompts and CSS
  // `:lang()` — it has to follow the resolved locale, not a hardcoded 'en'.
  const locale = await getServerLocale();

  return (
    <html
      lang={locale}
      data-theme-pair={theme.pairId}
      className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="stylesheet" href="https://unpkg.com/react-big-calendar/lib/css/react-big-calendar.css" />
        <link rel="stylesheet" href="https://unpkg.com/@radix-ui/themes@3.2.0/styles.css" />
        {/* Cascade order matters: the pair blocks in globals.css lose to the custom
            pair, which loses to the branding accents (they carry !important). */}
        {customThemeStyles && (
          <style
            id="server-tenant-theme-styles"
            dangerouslySetInnerHTML={{ __html: customThemeStyles }}
          />
        )}
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
           <MainContent tenant={tenant}>{children}</MainContent>
        </PostHogProvider>
      </body>
    </html>
  );
}
