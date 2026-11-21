'use client';

import { useCallback, useState } from 'react';
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
  /**
   * The authoritative saved prefs have resolved, the user has edited, or an override is active.
   * Consumers must not fetch before this: the localStorage stage alone can still be overwritten
   * by the server value, which would show unfiltered rows and then refetch.
   */
  isReady: boolean;
  /** A View All / deep-link override is in effect. */
  hasOverride: boolean;
  /** User edit: persists, takes over from the saved preference, clears any override. */
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
 * Until the user makes their own edit the saved filters (the `activitiesTableFilters`
 * preference) ARE the filters — read straight from the preference rather than mirrored into
 * local state through an effect. useUserPreference resolves in two stages (localStorage, then
 * the authoritative server value), so a mirror would always be one commit behind the value
 * `isReady` reports on, and consumers would fire their first query with the previous stage's
 * filters. Reading it directly keeps the two in step and still picks up the late server value,
 * instead of latching the initial default and silently dropping saved filters (due/created
 * dates, client, tags…) on reload.
 */
export function useActivityFilterState(
  opts: { initialOverride?: ActivityFilters } = {}
): ActivityFilterState {
  const {
    value: savedFilters,
    setValue: setSavedFilters,
    hasResolved: filtersResolved,
  } = useUserPreference<ActivityFilters>('activitiesTableFilters', {
    defaultValue: DEFAULT_ACTIVITY_FILTERS,
    localStorageKey: 'activitiesTableFilters',
    debounceMs: 1000,
  });

  const [userFilters, setUserFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [override, setOverride] = useState<ActivityFilters | null>(opts.initialOverride ?? null);
  const [userEdited, setUserEdited] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');

  const setFilters = useCallback((next: ActivityFilters) => {
    setUserEdited(true);
    setUserFilters(next);
    setOverride(null);
    setSavedFilters(next);
  }, [setSavedFilters]);

  const setOverrideFilters = useCallback((next: ActivityFilters) => setOverride(next), []);
  const clearOverride = useCallback(() => setOverride(null), []);

  return {
    filters: override ?? (userEdited ? userFilters : savedFilters),
    isReady: override !== null || filtersResolved || userEdited,
    hasOverride: override !== null,
    setFilters,
    setOverrideFilters,
    clearOverride,
    targetUserId,
    setTargetUserId,
  };
}
