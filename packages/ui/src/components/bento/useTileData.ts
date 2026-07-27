'use client';

import React, { use, useEffect, useRef, useState } from 'react';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '../../lib/errorHandling';

export type TileActionError = ActionMessageError | ActionPermissionError;
export type TileDataResult<T> = T | TileActionError;

export const isTileActionError = (value: unknown): value is TileActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

/**
 * Tile data source. When `initial` (a server-started promise from the RSC
 * page) is provided, the FIRST paint resolves it via React `use()` — the tile
 * suspends into its <Suspense> skeleton and issues NO network request. The
 * mount fetch is skipped; later dep changes (refreshKey after a mutation)
 * fall back to the client action as before. Without `initial`, behavior is
 * the legacy fetch-on-mount.
 */
export function useTileData<T>(
  load: () => Promise<TileDataResult<T>>,
  deps: React.DependencyList,
  t: (key: string, defaultValue: string) => string,
  initial?: Promise<TileDataResult<T>>,
): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  // Conditional use() is allowed by React; a resolved streamed promise
  // returns synchronously on re-renders.
  const initialResult = initial ? use(initial) : null;
  const initialData = initialResult && !isTileActionError(initialResult) ? initialResult : null;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<string | null>(
    initialResult && isTileActionError(initialResult) ? getErrorMessage(initialResult) : null,
  );
  const [loading, setLoading] = useState(!initial);
  const skipFirstLoad = useRef(Boolean(initial));

  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (cancelled) return;
        if (isTileActionError(result)) {
          setData(null);
          setError(getErrorMessage(result));
          return;
        }
        setData(result);
      })
      .catch((err: unknown) => {
        console.error('Failed to load bento tile:', err);
        if (!cancelled) setError(t('bento.tiles.couldNotLoad', 'Could not load this tile'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}
