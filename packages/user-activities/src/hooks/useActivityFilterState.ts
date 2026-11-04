'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityFilters } from '@alga-psa/types';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { DEFAULT_TABLE_TYPES } from '../components/constants';

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  types: DEFAULT_TABLE_TYPES,
  isClosed: false,
};

export interface ActivityFilterState {
  /** Effective filters (override ?? user/saved). */
  filters: ActivityFilters;
  /** Saved prefs resolved, the user has edited, or an override is active. */
  isReady: boolean;
  /** A View All / deep-link override is in effect. */
  hasOverride: boolean;
  /** User edit: persists, ends the saved-preference mirror, clears any override. */
  setFilters(filters: ActivityFilters): void;
  /** This visit only, never persisted (View All, deep-link "Clear filters"). */
  setOverrideFilters(filters: ActivityFilters): void;
  clearOverride(): void;
  /** '' = myself; in memory only. */
  targetUserId: string;
  setTargetUserId(id: string): void;
}

/**
 * The activities filter model shared by the table and cards views.
 *
 * Saved filters (the `activitiesTableFilters` preference) are mirrored into local state until
 * the user makes their own edit. This intentionally keeps syncing (rather than latching once)
 * because useUserPreference resolves in two stages — localStorage first, then the
 * authoritative server value. A one-shot sync could capture the initial default before the
 * persisted value arrives and then lock, silently dropping saved filters (due/created dates,
 * client, tags…) on reload.
 */
export function useActivityFilterState(
  opts: { initialOverride?: ActivityFilters } = {}
): ActivityFilterState {
  const {
    value: savedFilters,
    setValue: setSavedFilters,
    hasLoadedInitial: filtersLoaded,
  } = useUserPreference<ActivityFilters>('activitiesTableFilters', {
    defaultValue: DEFAULT_ACTIVITY_FILTERS,
    localStorageKey: 'activitiesTableFilters',
    debounceMs: 1000,
  });

  const [userFilters, setUserFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [override, setOverride] = useState<ActivityFilters | null>(opts.initialOverride ?? null);
  const [userEdited, setUserEdited] = useState(false);
  // Read inside the mirror effect without making an override change re-run it.
  const userEditedRef = useRef(false);
  const [targetUserId, setTargetUserId] = useState('');

  useEffect(() => {
    if (filtersLoaded && !userEditedRef.current) {
      setUserFilters(savedFilters);
    }
  }, [filtersLoaded, savedFilters]);

  const setFilters = useCallback((next: ActivityFilters) => {
    userEditedRef.current = true;
    setUserEdited(true);
    setUserFilters(next);
    setOverride(null);
    setSavedFilters(next);
  }, [setSavedFilters]);

  const setOverrideFilters = useCallback((next: ActivityFilters) => setOverride(next), []);
  const clearOverride = useCallback(() => setOverride(null), []);

  return {
    filters: override ?? userFilters,
    isReady: override !== null || filtersLoaded || userEdited,
    hasOverride: override !== null,
    setFilters,
    setOverrideFilters,
    clearOverride,
    targetUserId,
    setTargetUserId,
  };
}
