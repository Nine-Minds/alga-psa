'use client';

import type { Activity } from '@alga-psa/types';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Cache entry shape lives here (not in useActivitiesCache) so the provider module has no
 * dependency on the hook module, which tests mock wholesale.
 */
export interface ActivitiesCacheEntry {
  activities: Activity[];
  totalCount: number;
  timestamp: number;
  expiresAt: number;
}

export type ActivitiesCacheStore = Map<string, ActivitiesCacheEntry>;

interface ActivitiesCacheContextValue {
  cache: React.MutableRefObject<ActivitiesCacheStore>;
  invalidationVersion: number;
  notifyInvalidated: () => void;
}

const ActivitiesCacheContext = createContext<ActivitiesCacheContextValue | null>(null);

/**
 * Shares ONE activities cache (and an invalidation version counter) between the activities
 * list and the activity drawer, which are otherwise separate subtrees. Without it every
 * useActivitiesCache() call owned a private cache, so drawer edits never reached the list.
 */
export function ActivitiesCacheProvider({ children }: { children: ReactNode }) {
  const cache = useRef<ActivitiesCacheStore>(new Map());
  const [invalidationVersion, setInvalidationVersion] = useState(0);
  const notifyInvalidated = useCallback(() => setInvalidationVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({ cache, invalidationVersion, notifyInvalidated }),
    [invalidationVersion, notifyInvalidated]
  );

  return <ActivitiesCacheContext.Provider value={value}>{children}</ActivitiesCacheContext.Provider>;
}

/** Returns null when no provider is mounted (callers fall back to a private cache). */
export function useActivitiesCacheContext(): ActivitiesCacheContextValue | null {
  return useContext(ActivitiesCacheContext);
}

const NOOP = () => {};

/**
 * Invalidation signal shared via the provider. `version` increments each time a consumer
 * (e.g. the drawer) reports that data changed; the list subscribes and refetches.
 * Degrades to version 0 / no-op when no provider is mounted.
 */
export function useActivitiesInvalidationSignal(): { version: number; notifyInvalidated: () => void } {
  const ctx = useContext(ActivitiesCacheContext);
  return { version: ctx?.invalidationVersion ?? 0, notifyInvalidated: ctx?.notifyInvalidated ?? NOOP };
}
