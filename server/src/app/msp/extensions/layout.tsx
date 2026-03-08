import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Extensions',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
