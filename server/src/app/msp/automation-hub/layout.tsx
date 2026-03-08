import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Automation Hub',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
