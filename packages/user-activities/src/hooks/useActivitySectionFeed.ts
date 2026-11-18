'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity, ActivityFilters, ActivityType } from '@alga-psa/types';
import { useActivitiesCache } from './useActivitiesCache';
import { useActivitiesInvalidationSignal } from './ActivitiesCacheProvider';

export interface ActivitySectionFeed<T extends Activity> {
  activities: T[];
  totalCount: number;
  loading: boolean;
  /** The failure message when the latest request failed; sections show their own copy. */
  error: string | null;
  /** Invalidates the shared cache and reloads. */
  refresh(): void;
}

/**
 * One cards-view section's data: page 1 of the table's own query (`fetchActivities` through
 * the shared activities cache) narrowed to a single type. This is what keeps the cards and the
 * table at the same filter semantics.
 *
 * No `sortBy` is sent, so the server's default sort (priority, then due date, then newest) —
 * the table's default — applies.
 *
 * `options.enabled` is the gate for late-resolving filters: while false nothing is requested
 * and `loading` stays true, so the section never queries with provisional filters and then
 * refetches. Kept out of the request shape on purpose.
 */
export function useActivitySectionFeed<T extends Activity>(
  type: ActivityType,
  filters: ActivityFilters,
  targetUserId: string,
  limit: number,
  extra?: Pick<ActivityFilters, 'collapseRecurringSeries'>,
  options?: { enabled?: boolean }
): ActivitySectionFeed<T> {
  const enabled = options?.enabled ?? true;
  const { getActivities, invalidateCache } = useActivitiesCache();
  const [activities, setActivities] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // getActivities changes identity when its hook flips isInitialLoad; keep the latest in a ref
  // so that does not retrigger the load (the request key below decides when to fetch).
  const latest = useRef({ getActivities, invalidateCache });
  latest.current = { getActivities, invalidateCache };

  const requestFilters: ActivityFilters = {
    ...filters,
    types: [type],
    targetUserId: targetUserId || undefined,
    ...extra,
  };
  const requestKey = JSON.stringify([requestFilters, limit]);
  const requestFiltersRef = useRef(requestFilters);
  requestFiltersRef.current = requestFilters;

  // Rapid typing fires one request per keystroke per section; only the latest may commit.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await latest.current.getActivities(requestFiltersRef.current, 1, limit);
      if (requestId !== requestIdRef.current) return;
      setActivities(result.activities as T[]);
      setTotalCount(result.totalCount);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error(`Error loading ${type} activities:`, err);
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey encodes filters/target/extra
  }, [requestKey, limit, type]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [load, enabled]);

  const refresh = useCallback(() => {
    latest.current.invalidateCache();
    void load();
  }, [load]);

  // Refetch when another consumer of the shared cache (the activity drawer) reports a change.
  // Skip the initial value so mounting doesn't trigger a duplicate load.
  const { version: invalidationVersion } = useActivitiesInvalidationSignal();
  const lastHandledInvalidationVersion = useRef(invalidationVersion);
  useEffect(() => {
    if (invalidationVersion === lastHandledInvalidationVersion.current) return;
    // Record it even while disabled: the first enabled load is already fresh, so a bump that
    // arrived in the meantime must not fire a second request once the gate opens.
    lastHandledInvalidationVersion.current = invalidationVersion;
    if (!enabled) return;
    refresh();
  }, [invalidationVersion, refresh, enabled]);

  // Unmount: any in-flight response must not commit.
  useEffect(() => () => { requestIdRef.current += 1; }, []);

  return { activities, totalCount, loading, error, refresh };
}
