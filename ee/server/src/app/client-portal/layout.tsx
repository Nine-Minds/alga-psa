import type { Metadata } from 'next';

// This template overrides the root layout's template for all /client-portal/* pages.
// The default includes the suffix because defaults bypass their own template.
export const metadata: Metadata = {
  title: {
    template: '%s | Client Portal',
    default: 'Dashboard | Client Portal',
  },
};

export default function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
