'use client';

import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { useTheme } from 'next-themes';
import { useSession } from 'next-auth/react';
import { useFeatureFlag } from './useFeatureFlag';

type ThemePreference = 'light' | 'dark' | 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

interface ThemeActions {
  getPreference: () => Promise<ThemePreference | null>;
  savePreference: (theme: ThemePreference) => Promise<void>;
}

const ThemeActionsContext = createContext<ThemeActions | null>(null);

export function ThemeActionsProvider({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions: ThemeActions;
}) {
  return (
    <ThemeActionsContext.Provider value={actions}>
      {children}
    </ThemeActionsContext.Provider>
  );
}

export function useAppTheme() {
  const themeApi = useTheme();
  const { theme, setTheme } = themeApi;
  const { status } = useSession();
  const { enabled: themesEnabled, loading: themesLoading } = useFeatureFlag('themes-enabled');
  const actions = useContext(ThemeActionsContext);
  const [hasLoadedFromDb, setHasLoadedFromDb] = useState(false);
  const lastSyncedTheme = useRef<ThemePreference | null>(null);

  // Force light theme when feature flag is disabled (but not while still loading)
  useEffect(() => {
    if (!themesLoading && !themesEnabled && theme !== 'light') {
      setTheme('light');
    }
  }, [themesLoading, themesEnabled, theme, setTheme]);

  useEffect(() => {
    if (themesLoading || !themesEnabled || !actions) return;
    if (status !== 'authenticated' || hasLoadedFromDb) {
      return;
    }

    const loadPreference = async () => {
      try {
        const preference = await actions.getPreference();
        if (isThemePreference(preference) && preference !== theme) {
          setTheme(preference);
        }
      } catch (error) {
        console.error('Failed to load theme preference:', error);
      } finally {
        setHasLoadedFromDb(true);
      }
    };

    loadPreference();
  }, [themesEnabled, actions, hasLoadedFromDb, status, theme, setTheme]);

  useEffect(() => {
    if (themesLoading || !themesEnabled || !actions) return;
    if (status !== 'authenticated') {
      return;
    }

    const currentTheme = theme;
    if (!isThemePreference(currentTheme) || currentTheme === lastSyncedTheme.current) {
      return;
    }

    lastSyncedTheme.current = currentTheme;

    const persistPreference = async () => {
      try {
        await actions.savePreference(currentTheme);
      } catch (error) {
        console.error('Failed to save theme preference:', error);
      }
    };

    persistPreference();
  }, [themesEnabled, actions, status, theme]);

  return {
    ...themeApi,
    hasLoadedFromDb,
  };
}
