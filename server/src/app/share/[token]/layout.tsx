import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared Document',
};

export default function ShareTokenLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
