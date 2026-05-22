'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface UseRangeSelectionOptions<T> {
  items: readonly T[];
  getId: (item: T) => string | null | undefined;
  selectedIds: ReadonlySet<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
}

export interface RangeSelectionEventLike {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  selected?: boolean;
  preventDefault?: () => void;
}

export interface UseRangeSelectionResult {
  isSelected: (id: string) => boolean;
  handleSelect: (id: string, event?: RangeSelectionEventLike) => void;
  resetAnchor: () => void;
}

export function useRangeSelection<T>({
  items,
  getId,
  selectedIds,
  onSelectedIdsChange,
}: UseRangeSelectionOptions<T>): UseRangeSelectionResult {
  const anchorRef = useRef<string | null>(null);

  const orderedIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of items) {
      const id = getId(item);
      if (typeof id === 'string' && id.length > 0) {
        ids.push(id);
      }
    }
    return ids;
  }, [items, getId]);

  useEffect(() => {
    if (anchorRef.current && !orderedIds.includes(anchorRef.current)) {
      anchorRef.current = null;
    }
  }, [orderedIds]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const handleSelect = useCallback(
    (id: string, event?: RangeSelectionEventLike) => {
      const shift = Boolean(event?.shiftKey);
      const shouldSelect = event?.selected ?? !selectedIds.has(id);
      const next = new Set(selectedIds);

      if (shift && anchorRef.current && anchorRef.current !== id) {
        const aIdx = orderedIds.indexOf(anchorRef.current);
        const bIdx = orderedIds.indexOf(id);
        if (aIdx >= 0 && bIdx >= 0) {
          const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
          for (let i = lo; i <= hi; i += 1) {
            if (shouldSelect) {
              next.add(orderedIds[i]);
            } else {
              next.delete(orderedIds[i]);
            }
          }
          anchorRef.current = id;
          event?.preventDefault?.();
          onSelectedIdsChange(next);
          return;
        }
      }

      if (shouldSelect) {
        next.add(id);
      } else {
        next.delete(id);
      }
      anchorRef.current = id;
      onSelectedIdsChange(next);
    },
    [orderedIds, selectedIds, onSelectedIdsChange],
  );

  const resetAnchor = useCallback(() => {
    anchorRef.current = null;
  }, []);

  return { isSelected, handleSelect, resetAnchor };
}
