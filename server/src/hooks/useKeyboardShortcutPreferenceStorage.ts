'use client';

import { useMemo } from 'react';
import {
  EMPTY_SHORTCUT_PREFERENCES,
  KEYBOARD_SHORTCUTS_PREFERENCE_KEY,
  migrateShortcutPreferences,
  type ShortcutStorage,
} from '@alga-psa/ui/keyboard-shortcuts';
import { useUserPreference } from '@alga-psa/user-composition/hooks';

interface Options {
  userId?: string;
  skipServerFetch?: boolean;
}

export function useKeyboardShortcutPreferenceStorage(options: Options = {}) {
  const preference = useUserPreference(KEYBOARD_SHORTCUTS_PREFERENCE_KEY, {
    defaultValue: EMPTY_SHORTCUT_PREFERENCES,
    localStorageKey: KEYBOARD_SHORTCUTS_PREFERENCE_KEY,
    userId: options.userId,
    skipServerFetch: options.skipServerFetch,
  });

  const value = useMemo(() => migrateShortcutPreferences(preference.value), [preference.value]);
  const storage = useMemo<ShortcutStorage>(() => ({
    load: () => value,
    save: (nextValue) => preference.setValue(migrateShortcutPreferences(nextValue)),
  }), [preference.setValue, value]);

  return {
    ...preference,
    value,
    storage,
  };
}
