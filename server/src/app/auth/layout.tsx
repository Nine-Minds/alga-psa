import type { ReactNode } from 'react';
import { Theme } from '@radix-ui/themes';
import { AppThemeProvider } from '@/components/providers/AppThemeProvider';
import { ThemeBridge } from '@/components/providers/ThemeBridge';

export default function AuthLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {

  return (
    <AppThemeProvider forcedTheme="light">
      <ThemeBridge>
        <Theme>
          {children}
        </Theme>
      </ThemeBridge>
    </AppThemeProvider>
  );
}
