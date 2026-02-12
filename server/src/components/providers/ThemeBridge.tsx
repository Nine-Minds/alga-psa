'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { Theme } from '@radix-ui/themes';
import { useTheme } from 'next-themes';

type ThemeBridgeProps = {
  children: ReactNode;
};

export function ThemeBridge({ children }: ThemeBridgeProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const appearance = resolvedTheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', appearance);
    // Ensure the class on <html> matches the resolved theme.
    // next-themes may not update the class when forcedTheme changes
    // dynamically (e.g. client-side navigation to/from auth routes).
    root.classList.remove('light', 'dark');
    root.classList.add(appearance);
    root.style.colorScheme = appearance;
  }, [appearance]);

  // Until next-themes has resolved, hide content to prevent light-mode flash.
  // The body background is handled by CSS vars that next-themes' blocking script
  // already set via the .dark/.light class on <html>.
  if (!mounted) {
    return (
      <div style={{ visibility: 'hidden' }}>
        <MantineProvider forceColorScheme="light">
          <Theme appearance="light">
            {children}
          </Theme>
        </MantineProvider>
      </div>
    );
  }

  return (
    <MantineProvider forceColorScheme={appearance}>
      <Theme appearance={appearance}>
        {children}
      </Theme>
    </MantineProvider>
  );
}
