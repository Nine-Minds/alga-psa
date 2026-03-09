import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Template Details',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
