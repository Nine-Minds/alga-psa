import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Purchase Licenses',
};

export default function LicensePurchaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
