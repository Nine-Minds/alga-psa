'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { ThemeActionsProvider } from '@alga-psa/ui/hooks/useAppTheme';
import { getThemePreferenceAction, updateThemePreferenceAction } from '@alga-psa/users/actions';

type AppThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: string;
  forcedTheme?: string;
};

export function AppThemeProvider({ children, defaultTheme = 'light', forcedTheme }: AppThemeProviderProps) {
  const pathname = usePathname();

  // Always force light theme on auth pages — dark mode is feature-flagged
  // and should never appear to unauthenticated users. This client-side
  // check is the reliable source of truth (server-side header detection
  // can miss on certain navigations).
  const resolvedForcedTheme = pathname?.startsWith('/auth/') ? 'light' : forcedTheme;

  const actions = useMemo(() => ({
    getPreference: getThemePreferenceAction,
    savePreference: async (theme: 'light' | 'dark' | 'system') => {
      await updateThemePreferenceAction(theme);
    },
  }), []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      forcedTheme={resolvedForcedTheme}
      enableSystem={!resolvedForcedTheme}
      disableTransitionOnChange
    >
      <ThemeActionsProvider actions={actions}>
        {children}
      </ThemeActionsProvider>
    </ThemeProvider>
  );
}
