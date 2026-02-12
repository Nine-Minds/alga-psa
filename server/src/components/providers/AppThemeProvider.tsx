'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ThemeProvider } from 'next-themes';
import { ThemeActionsProvider } from '@alga-psa/ui/hooks/useAppTheme';
import { getThemePreferenceAction, updateThemePreferenceAction } from '@alga-psa/users/actions';

type AppThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: string;
  forcedTheme?: string;
};

export function AppThemeProvider({ children, defaultTheme = 'system', forcedTheme }: AppThemeProviderProps) {
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
      forcedTheme={forcedTheme}
      enableSystem={!forcedTheme}
      disableTransitionOnChange
    >
      <ThemeActionsProvider actions={actions}>
        {children}
      </ThemeActionsProvider>
    </ThemeProvider>
  );
}
