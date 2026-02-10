'use client';

import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Theme } from '@radix-ui/themes';
import { useTheme } from 'next-themes';

type ThemeBridgeProps = {
  children: ReactNode;
};

export function ThemeBridge({ children }: ThemeBridgeProps) {
  const { resolvedTheme } = useTheme();
  const appearance = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <MantineProvider forceColorScheme={appearance}>
      <Theme appearance={appearance}>
        {children}
      </Theme>
    </MantineProvider>
  );
}
