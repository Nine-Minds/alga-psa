'use client';

/**
 * Which body an inbound-email message is read as: the stored rich text, or the
 * archived original.
 *
 * The choice is a user preference, not per-message state: a reader who asks for
 * the original on one comment wants it on the next ticket too. Every
 * `useInboundEmailView` caller on the page therefore shares this one
 * module-level store, seeded from `localStorage` so the choice survives a
 * reload before the server preference arrives. Server persistence is layered
 * on top by `useInboundEmailViewPreference` (in `@alga-psa/tickets`), which
 * writes the same key through the normal user-preference actions; this module
 * stays free of server imports so `@alga-psa/ui` keeps no dependency on them.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type InboundEmailViewMode = 'text' | 'email';

/** User-preference / localStorage key, shared by the MSP and portal screens. */
export const INBOUND_EMAIL_VIEW_MODE_SETTING = 'ticket_email_view_mode';

const DEFAULT_MODE: InboundEmailViewMode = 'text';

/** `null` until first read, so hydration happens lazily on the client only. */
let currentMode: InboundEmailViewMode | null = null;
const listeners = new Set<() => void>();

function readStoredMode(): InboundEmailViewMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(INBOUND_EMAIL_VIEW_MODE_SETTING);
    if (raw === null) return DEFAULT_MODE;
    // Written by useUserPreference as JSON, so parse the same way.
    return JSON.parse(raw) === 'email' ? 'email' : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function getSnapshot(): InboundEmailViewMode {
  if (currentMode === null) currentMode = readStoredMode();
  return currentMode;
}

/** SSR and the hydration render always start from the default. */
function getServerSnapshot(): InboundEmailViewMode {
  return DEFAULT_MODE;
}

/** Notified on every change; returns the unsubscribe. */
export function subscribeInboundEmailViewMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInboundEmailViewMode(): InboundEmailViewMode {
  return getSnapshot();
}

export function setInboundEmailViewMode(next: InboundEmailViewMode): void {
  if (getSnapshot() === next) return;
  currentMode = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(INBOUND_EMAIL_VIEW_MODE_SETTING, JSON.stringify(next));
    } catch {
      // Private-mode storage failure: the in-memory choice still holds.
    }
  }
  for (const listener of listeners) listener();
}

/** The shared mode plus a setter; every reader re-renders on a change. */
export function useInboundEmailViewMode(): [
  InboundEmailViewMode,
  (next: InboundEmailViewMode) => void,
] {
  const mode = useSyncExternalStore(
    subscribeInboundEmailViewMode,
    getSnapshot,
    getServerSnapshot
  );
  const setMode = useCallback((next: InboundEmailViewMode) => setInboundEmailViewMode(next), []);
  return [mode, setMode];
}
