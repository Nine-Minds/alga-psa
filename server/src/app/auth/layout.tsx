import { Theme } from '@radix-ui/themes';

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <Theme>
      {children}
    </Theme>
  );
}
