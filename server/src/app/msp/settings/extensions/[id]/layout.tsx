import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Extension Settings',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
