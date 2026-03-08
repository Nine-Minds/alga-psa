import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Onboarding Test',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
