import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Team Setup',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
