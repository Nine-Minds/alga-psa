'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ThemeProvider } from 'next-themes';
import { ThemeActionsProvider } from '@alga-psa/ui/hooks/useAppTheme';
import { getThemePreferenceAction, updateThemePreferenceAction } from '@alga-psa/users/actions';

type AppThemeProviderProps = {
  children: ReactNode;
};

export function AppThemeProvider({ children }: AppThemeProviderProps) {
  const actions = useMemo(() => ({
    getPreference: getThemePreferenceAction,
    savePreference: async (theme: 'light' | 'dark' | 'system') => {
      await updateThemePreferenceAction(theme);
    },
  }), []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeActionsProvider actions={actions}>
        {children}
      </ThemeActionsProvider>
    </ThemeProvider>
  );
}
