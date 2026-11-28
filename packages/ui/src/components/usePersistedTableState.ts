import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface PersistedTableStateOptions<T> {
  /** Controlled value. Wins over internal state while it is not undefined. */
  controlled?: T;
  /** Called with the next value whenever the user changes it through the setter. */
  onChange?: (value: T) => void;
}

/**
 * localStorage-backed, optionally controlled, per-key view state for tables.
 * - `storageKey` null/undefined: nothing is read or written (plain local state).
 * - Stored JSON is passed through `parse`; anything it cannot accept must yield `defaultValue`.
 * - The stored value is read in a layout effect (before paint) and nothing is written until then.
 * - Never throws when localStorage is unavailable.
 */
export function usePersistedTableState<T>(
  storageKey: string | null | undefined,
  defaultValue: T,
  parse: (raw: unknown) => T,
  options: PersistedTableStateOptions<T> = {}
): [value: T, setValue: (next: T) => void, hasLoaded: boolean] {
  const { controlled, onChange } = options;
  const [value, setInternal] = useState<T>(defaultValue);
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadedKeyRef = useRef<string | null | undefined>(undefined);

  const parseRef = useRef(parse);
  parseRef.current = parse;
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useIsomorphicLayoutEffect(() => {
    let next = defaultRef.current;
    if (storageKey && typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(storageKey);
        next = stored === null ? defaultRef.current : parseRef.current(JSON.parse(stored));
      } catch {
        next = defaultRef.current;
      }
    }
    setInternal(next);
    loadedKeyRef.current = storageKey;
    setHasLoaded(true);
  }, [storageKey]);

  // Mirror controlled values into internal state so dropping back to uncontrolled keeps them.
  useEffect(() => {
    if (controlled !== undefined) setInternal(controlled);
  }, [controlled]);

  const setValue = useCallback(
    (next: T) => {
      setInternal(next);
      onChangeRef.current?.(next);
      if (storageKey && loadedKeyRef.current === storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage unavailable or full: keep in-memory state only
        }
      }
    },
    [storageKey]
  );

  return [controlled ?? value, setValue, hasLoaded];
}
