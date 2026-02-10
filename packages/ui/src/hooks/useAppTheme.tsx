'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { useSession } from 'next-auth/react';
import { useFeatureFlag } from './useFeatureFlag';

type ThemePreference = 'light' | 'dark' | 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function useAppTheme() {
  const themeApi = useTheme();
  const { theme, setTheme } = themeApi;
  const { data: session, status } = useSession();
  const { enabled: themesEnabled } = useFeatureFlag('themes-enabled');
  const [hasLoadedFromDb, setHasLoadedFromDb] = useState(false);
  const lastSyncedTheme = useRef<ThemePreference | null>(null);

  const userId = useMemo(() => {
    const user = session?.user as { id?: string; user_id?: string } | undefined;
    return user?.id ?? user?.user_id ?? null;
  }, [session?.user]);

  // Force light theme when feature flag is disabled
  useEffect(() => {
    if (!themesEnabled && theme !== 'light') {
      setTheme('light');
    }
  }, [themesEnabled, theme, setTheme]);

  useEffect(() => {
    if (!themesEnabled) return;
    if (status !== 'authenticated' || !userId || hasLoadedFromDb) {
      return;
    }

    const loadPreference = async () => {
      try {
        const response = await fetch(`/api/v1/users/${userId}/preferences`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`Failed to load preferences (${response.status})`);
        }
        const result = await response.json();
        const preference = result?.data?.theme;
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
  }, [themesEnabled, hasLoadedFromDb, status, theme, setTheme, userId]);

  useEffect(() => {
    if (!themesEnabled) return;
    if (status !== 'authenticated' || !userId) {
      return;
    }

    const currentTheme = theme;
    if (!isThemePreference(currentTheme) || currentTheme === lastSyncedTheme.current) {
      return;
    }

    lastSyncedTheme.current = currentTheme;

    const persistPreference = async () => {
      try {
        await fetch(`/api/v1/users/${userId}/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: currentTheme }),
        });
      } catch (error) {
        console.error('Failed to save theme preference:', error);
      }
    };

    persistPreference();
  }, [themesEnabled, status, theme, userId]);

  return {
    ...themeApi,
    hasLoadedFromDb,
  };
}
