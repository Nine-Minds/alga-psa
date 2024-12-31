import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { initializeApp } from "../lib/actions/initializeApp";
import "./globals.css";
import { Toaster } from 'react-hot-toast';
import { getCurrentTenant } from "../lib/actions/tenantActions";
import { TenantProvider } from "../components/TenantProvider";
import { Suspense } from "react";
import { Theme } from '@radix-ui/themes';
import { ThemeProvider } from '../context/ThemeContext';
import { ClientUIStateProvider } from '../types/ui-reflection/ClientUIStateProvider';

const inter = Inter({ subsets: ["latin"] });

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  await initializeApp();
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

function Loading() {
  return <div>Loading...</div>;
}

async function MainContent({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  return (
    <TenantProvider tenant={tenant}>
      <ThemeProvider>
        <Theme>
          <ClientUIStateProvider
            initialPageState={{
              id: 'msp-application',
              title: 'MSP Application',
              components: []
            }}
          >
            <div className="min-h-screen bg-background font-sans antialiased">
              {children}
            </div>
          </ClientUIStateProvider>
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
    <html lang="en" className={inter.className}>
      <body className={`${inter.className} light`}>
        <Suspense fallback={<Loading />}>
          <MainContent>{children}</MainContent>
        </Suspense>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
