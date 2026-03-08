import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Check Email',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
