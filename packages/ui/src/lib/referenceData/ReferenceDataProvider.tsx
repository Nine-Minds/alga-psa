'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useSWRConfig } from 'swr';
import {
  isReferenceListError,
  referenceListCacheKey,
  type LoadReferenceLists,
  type ReferenceListEntry,
  type ReferenceListKey,
} from './registry';

type Mutate = ReturnType<typeof useSWRConfig>['mutate'];

export interface ReferenceListStore {
  /** Identity scope (tenant + user). Required: nothing is fetched or read without one. */
  scope: string | undefined;
  /** Queue keys for fetching. Keys queued in the same tick share one `load` call. */
  request(keys: ReferenceListKey[]): void;
  /** Mark cached entries stale so mounted consumers refetch them. */
  invalidate(keys: ReferenceListKey[]): void;
}

const ReferenceDataContext = createContext<ReferenceListStore | null>(null);

export function useReferenceListStore(): ReferenceListStore | null {
  return useContext(ReferenceDataContext);
}

// Every mounted provider registers here so `invalidateReferenceList` needs neither a scope nor an
// SWR handle from the caller, and also reaches a provider that owns a non-default SWR cache.
const mountedStores = new Set<ReferenceListStore>();

/**
 * Invalidate cached reference lists after a mutation succeeded. Mounted consumers refetch the
 * invalidated keys (and only those); unmounted ones refetch on their next mount.
 */
export function invalidateReferenceList(keys: ReferenceListKey | ReferenceListKey[]): void {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const store of mountedStores) store.invalidate(list);
}

interface ReferenceDataProviderProps {
  load: LoadReferenceLists;
  /** Tenant + user identity. Until it is known nothing is fetched. */
  scope: string | undefined;
  children: React.ReactNode;
}

export function ReferenceDataProvider({ load, scope, children }: ReferenceDataProviderProps) {
  const { mutate } = useSWRConfig();
  const loadRef = useRef(load);
  loadRef.current = load;
  const mutateRef = useRef<Mutate>(mutate);
  mutateRef.current = mutate;

  const store = useMemo<ReferenceListStore>(() => {
    const inFlight = new Set<string>();
    let queued: ReferenceListKey[] = [];
    let flushScheduled = false;
    const generation = new Map<ReferenceListKey, number>();
    const startedAt = new Map<ReferenceListKey, number>();

    const write = (key: ReferenceListKey, entry: ReferenceListEntry) =>
      mutateRef.current(referenceListCacheKey(scope as string, key), entry, { revalidate: false });

    const flush = async () => {
      flushScheduled = false;
      const keys = queued;
      queued = [];
      if (!scope || keys.length === 0) return;
      for (const key of keys) startedAt.set(key, generation.get(key) ?? 0);
      let result: Partial<Record<ReferenceListKey, unknown>> | undefined;
      let failure: unknown;
      try {
        result = await loadRef.current(keys);
      } catch (error) {
        failure = error;
      }
      for (const key of keys) {
        inFlight.delete(key);
        const raw = result?.[key];
        if (result && !isReferenceListError(raw) && key in result) {
          // Invalidated while the fetch was in flight: the value may predate the mutation, so keep
          // it for display but leave it marked stale for the next consumer pass.
          const invalidated = (generation.get(key) ?? 0) !== startedAt.get(key);
          await write(key, { status: 'ok', value: raw, fetchedAt: Date.now(), ...(invalidated ? { invalidated } : {}) });
        } else {
          const message = isReferenceListError(raw)
            ? raw.message
            : failure instanceof Error
              ? failure.message
              : undefined;
          // Keep whatever was cached for the key; the marker only stops it showing as "loading".
          await mutateRef.current(
            referenceListCacheKey(scope, key),
            (current: ReferenceListEntry | undefined) => ({
              status: 'error' as const,
              value: current?.value,
              message,
              fetchedAt: Date.now(),
            }),
            { revalidate: false }
          );
        }
      }
    };

    return {
      scope,
      request(keys) {
        if (!scope) return;
        for (const key of keys) {
          if (inFlight.has(key) || queued.includes(key)) continue;
          inFlight.add(key);
          queued.push(key);
        }
        if (!flushScheduled && queued.length > 0) {
          flushScheduled = true;
          queueMicrotask(() => void flush());
        }
      },
      invalidate(keys) {
        if (!scope) return;
        for (const key of keys) {
          generation.set(key, (generation.get(key) ?? 0) + 1);
          void mutateRef.current(
            referenceListCacheKey(scope, key),
            (current: ReferenceListEntry | undefined) =>
              current ? { ...current, invalidated: true } : current,
            { revalidate: false }
          );
        }
      },
    };
  }, [scope]);

  useEffect(() => {
    mountedStores.add(store);
    return () => {
      mountedStores.delete(store);
    };
  }, [store]);

  return <ReferenceDataContext.Provider value={store}>{children}</ReferenceDataContext.Provider>;
}
