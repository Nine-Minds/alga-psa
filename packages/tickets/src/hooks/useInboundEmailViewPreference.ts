'use client';

/**
 * Persists the Text / Email view choice the way every other view mode is
 * persisted: a per-user preference row, mirrored into localStorage.
 *
 * The bodies themselves read a module-level store in `@alga-psa/ui` (so all of
 * a ticket's messages switch together without prop drilling); this hook is the
 * one place per ticket screen that marries that store to the stored
 * preference. Mount it once — the MSP and portal ticket details do — and every
 * `useInboundEmailView` body below it inherits the reader's standing choice.
 */

import { useEffect, useRef } from 'react';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import {
  getInboundEmailViewMode,
  INBOUND_EMAIL_VIEW_MODE_SETTING,
  setInboundEmailViewMode,
  useInboundEmailViewMode,
  type InboundEmailViewMode,
} from '@alga-psa/ui/lib/inboundEmailViewMode';

function isViewMode(value: unknown): value is InboundEmailViewMode {
  return value === 'text' || value === 'email';
}

export function useInboundEmailViewPreference(): void {
  const { value, setValue, isLoading } = useUserPreference<InboundEmailViewMode>(
    INBOUND_EMAIL_VIEW_MODE_SETTING,
    {
      defaultValue: 'text',
      localStorageKey: INBOUND_EMAIL_VIEW_MODE_SETTING,
      debounceMs: 300,
    }
  );
  const [mode] = useInboundEmailViewMode();
  // Last mode the two sides agreed on; `null` until the preference resolves.
  const syncedRef = useRef<InboundEmailViewMode | null>(null);

  // Stored preference wins once it has actually resolved; before that `value`
  // is still the default and would clobber what localStorage already seeded.
  useEffect(() => {
    if (isLoading || !isViewMode(value)) return;
    syncedRef.current = value;
    setInboundEmailViewMode(value);
  }, [isLoading, value]);

  // A switch anywhere on the page becomes the reader's standing preference.
  // Reads the store directly: `mode` is the value this render closed over, and
  // the effect above may have just moved the store past it.
  useEffect(() => {
    if (isLoading || syncedRef.current === null) return;
    const current = getInboundEmailViewMode();
    if (current === syncedRef.current) return;
    syncedRef.current = current;
    setValue(current);
  }, [isLoading, mode, setValue]);
}

export default useInboundEmailViewPreference;
