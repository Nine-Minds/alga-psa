import type { Metadata } from "next";
import "./globals.css";
// Global vendor CSS for react-big-calendar is added via a <link> tag below
import { Toaster } from 'react-hot-toast';
import { getCurrentTenant } from "../lib/actions/tenantActions";
import { TenantProvider } from "../components/TenantProvider";
import { Theme } from '@radix-ui/themes';
import { ThemeProvider } from '../context/ThemeContext';
import { TagProvider } from '../context/TagContext';
import { ClientUIStateProvider } from '../types/ui-reflection/ClientUIStateProvider';
import { DynamicExtensionProvider } from '../components/extensions/DynamicExtensionProvider';
import { PostHogProvider } from "../components/PostHogProvider";
import { I18nWrapper } from "../components/i18n/I18nWrapper";
import { getServerLocale } from "../lib/i18n/server";
import { cookies } from 'next/headers';

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
          url: "https://strapi-marketing-website-uploads.s3.us-east-1.amazonaws.com/Blog_Updates_Thumbnail_1250_x_720_px_3_53750d92c3.png",
          width: 1200,
          height: 630,
          alt: "Sebastian Application",
        },
      ],
    },
  };
}

async function MainContent({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  return (
    <TenantProvider tenant={tenant}>
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
    </TenantProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/react-big-calendar/lib/css/react-big-calendar.css" />
        <link rel="stylesheet" href="https://unpkg.com/@radix-ui/themes@3.2.0/styles.css" />
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
