import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// This template overrides the root layout's template for all /auth/* pages.
// The default includes the suffix because defaults bypass their own template.
export const metadata: Metadata = {
  title: {
    template: '%s | AlgaPSA',
    default: 'Sign In | AlgaPSA',
  },
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <>{children}</>;
}
