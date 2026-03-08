import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Set New Password',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
