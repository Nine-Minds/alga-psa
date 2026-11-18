'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useReferenceListStore } from './ReferenceDataProvider';
import {
  REFERENCE_LIST_FRESH_FOR_MS,
  REFERENCE_LIST_KEYS,
  referenceListCacheKey,
  type ReferenceListEntry,
  type ReferenceListKey,
  type ReferenceListValues,
} from './registry';

export interface UseReferenceListsOptions {
  /** Per-key override of the registry freshness window (ms). `0` revalidates on every mount. */
  freshForMs?: Partial<Record<ReferenceListKey, number>>;
}

export interface UseReferenceListsResult<K extends ReferenceListKey> {
  /** Loaded values. A key is absent until it has loaded, and stays absent if its load failed. */
  data: { [P in K]?: ReferenceListValues[P] };
  /** True until the key has an entry (value or error) for this scope. Cached values are never "loading". */
  loading: Record<K, boolean>;
  /** Keys whose last load failed. */
  errors: { [P in K]?: string };
}

// The cache is only read here: values are written by the provider's batcher, so the fetcher is null.
const READ_ONLY = {
  revalidateOnMount: false,
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
} as const;

function useEntry(scope: string | undefined, key: ReferenceListKey, requested: boolean) {
  const swrKey = scope && requested ? referenceListCacheKey(scope, key) : null;
  return useSWR<ReferenceListEntry>(swrKey, null, READ_ONLY).data;
}

function isStale(
  entry: ReferenceListEntry | undefined,
  key: ReferenceListKey,
  freshForMs: number,
  revalidatedThisMount: Set<ReferenceListKey>
): boolean {
  if (!entry || entry.status === 'error' || entry.invalidated) return true;
  if (freshForMs === 0) return !revalidatedThisMount.has(key);
  return Date.now() - entry.fetchedAt >= freshForMs;
}

/**
 * Reads reference lists from the shared SWR cache (`['ref', scope, key]`). Missing or stale keys are
 * fetched together in one batched `load` call; each result is cached under its own key, so one slow
 * or failing list never holds back the others. Needs a `ReferenceDataProvider` with a scope.
 */
export function useReferenceLists<K extends ReferenceListKey>(
  keys: readonly K[],
  options: UseReferenceListsOptions = {}
): UseReferenceListsResult<K> {
  const store = useReferenceListStore();
  const scope = store?.scope;
  // Fixed-length loop over the registry keeps the hook count constant while `keys` varies.
  const entries = new Map<ReferenceListKey, ReferenceListEntry | undefined>();
  for (const key of REFERENCE_LIST_KEYS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- REFERENCE_LIST_KEYS has a constant length
    entries.set(key, useEntry(scope, key, (keys as readonly ReferenceListKey[]).includes(key)));
  }

  // Keys already revalidated by this mount (for always-revalidate lists). Reset when scope changes.
  const revalidated = useRef<{ scope: string | undefined; keys: Set<ReferenceListKey> }>({
    scope,
    keys: new Set(),
  });
  if (revalidated.current.scope !== scope) revalidated.current = { scope, keys: new Set() };

  const keySignature = keys.join('|');
  const entrySignature = keys
    .map((key) => {
      const entry = entries.get(key);
      return entry ? `${entry.status}:${entry.fetchedAt}:${entry.invalidated ? 1 : 0}` : '-';
    })
    .join('|');

  useEffect(() => {
    if (!store || !scope) return;
    const stale: ReferenceListKey[] = [];
    for (const key of keys) {
      const freshForMs = options.freshForMs?.[key] ?? REFERENCE_LIST_FRESH_FOR_MS[key];
      if (isStale(entries.get(key), key, freshForMs, revalidated.current.keys)) {
        // An errored or invalidated entry is retried once per pass; the entry signature changing
        // after the result lands re-runs this effect, which is why errors are not re-requested here.
        const entry = entries.get(key);
        if (entry?.status === 'error' && !entry.invalidated && revalidated.current.keys.has(key)) continue;
        stale.push(key);
      }
    }
    if (stale.length === 0) return;
    for (const key of stale) revalidated.current.keys.add(key);
    store.request(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signatures capture keys and entries
  }, [store, scope, keySignature, entrySignature]);

  const data: Partial<Record<ReferenceListKey, unknown>> = {};
  const loading = {} as Record<ReferenceListKey, boolean>;
  const errors: Partial<Record<ReferenceListKey, string>> = {};
  for (const key of keys) {
    const entry = entries.get(key);
    loading[key] = !scope || !entry;
    if (entry && entry.value !== undefined) data[key] = entry.value;
    if (entry?.status === 'error') errors[key] = entry.message ?? 'Failed to load';
  }
  return {
    data: data as UseReferenceListsResult<K>['data'],
    loading: loading as UseReferenceListsResult<K>['loading'],
    errors: errors as UseReferenceListsResult<K>['errors'],
  };
}
