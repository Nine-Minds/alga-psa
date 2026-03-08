import type { Metadata } from 'next';

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
