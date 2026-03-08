import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Appointments',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
