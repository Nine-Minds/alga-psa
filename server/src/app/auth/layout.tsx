import type { ReactNode } from 'react';


export const metadata = {
  title: {
    template: '%s | Alga PSA',
    default: 'Sign In | Alga PSA',
  },
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <>{children}</>;
}
