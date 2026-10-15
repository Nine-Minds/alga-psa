'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTier } from '@/context/TierContext';
import { useProduct } from '@/context/ProductContext';
import { getCoManagedWorkSignalsAction } from '@/lib/actions/coManagedTicketQueueActions';

export interface CoManagedWorkSignalsValue {
  /** True only when the flag resolved on, the tenant is a sponsoring PSA Pro tenant, and the reader reported at least one staff-assigned relationship. */
  available: boolean;
  /** Signed-in viewer; dismissal is remembered per viewer. */
  viewerId: string | null;
  escalatedUnassigned: number;
  awaitingReply: number;
  /** Sum of the two signals; the menu badge shows this and hides at zero. */
  total: number;
  /**
   * Re-read the counts now. Call after an action that changes them (escalate,
   * hand back, bulk hand back, assignment). A no-op outside the provider or when the gate is closed.
   */
  refresh: () => void;
}

export const EMPTY_CO_MANAGED_WORK_SIGNALS: CoManagedWorkSignalsValue = {
  available: false, viewerId: null, escalatedUnassigned: 0, awaitingReply: 0, total: 0, refresh: () => {},
};

const CoManagedWorkSignalsContext = createContext<CoManagedWorkSignalsValue>(EMPTY_CO_MANAGED_WORK_SIGNALS);

export function useCoManagedWorkSignals(): CoManagedWorkSignalsValue {
  return useContext(CoManagedWorkSignalsContext);
}

/** Run `fn` after the page has had a chance to paint, so the read never competes with the native list. */
function afterPaint(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(fn, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(fn, 250);
  return () => window.clearTimeout(handle);
}

/**
 * How long counts may go unrefreshed while the tab is visible. Counts only change
 * when someone acts (in this tab: refresh() fires immediately; in another tab or by
 * another user: this interval or a focus/visibility return catches it). One minute
 * keeps the badge within a minute of the truth for a single authorized queue read per
 * open tab, and a hidden tab makes no reads at all.
 */
export const CO_MANAGED_SIGNALS_REFRESH_MS = 60_000;

/**
 * Loads the callout counts lazily after mount, then keeps them fresh on an interval, on
 * window focus / returning to a visible tab, and on an explicit refresh() from
 * co-managed actions. It never re-reads on navigation. Presentation only: the
 * release flag decides whether to ask at all; the server action authorizes the
 * read regardless. Any failure leaves the context empty (nothing renders).
 */
export function CoManagedWorkSignalsProvider({ viewerId, children }: { viewerId?: string | null; children: React.ReactNode }) {
  const { productCode } = useProduct();
  const { isPro } = useTier();
  const flag = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const flagOn = flag?.enabled === true && !flag.loading && !flag.error;
  const sponsoring = flagOn && productCode === 'psa' && isPro;
  const [data, setData] = useState<{ assigned: number; escalatedUnassigned: number; awaitingReply: number } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    const mine = ++generation.current;
    inFlight.current = true;
    getCoManagedWorkSignalsAction({})
      .then((result) => {
        if (mine === generation.current) inFlight.current = false;
        if (mine !== generation.current) return;
        if (!result || typeof result !== 'object' || !('signals' in result)) { setData(null); return; }
        setData({
          assigned: result.assignedRelationshipCount ?? 0,
          escalatedUnassigned: result.signals?.escalatedUnassigned ?? 0,
          awaitingReply: result.signals?.awaitingReply ?? 0,
        });
      })
      .catch(() => { if (mine === generation.current) { inFlight.current = false; setData(null); } });
  }, []);

  // First read waits for idle so it never competes with the native list.
  useEffect(() => {
    if (!sponsoring) { generation.current += 1; inFlight.current = false; setData(null); return; }
    return afterPaint(load);
  }, [sponsoring, load]);

  // Background freshness: interval, focus, and return to a visible tab. Skipped while a read is in flight or the tab is hidden.
  useEffect(() => {
    if (!sponsoring) return;
    const maybeLoad = () => {
      if (inFlight.current || document.visibilityState === 'hidden') return;
      load();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') maybeLoad(); };
    const timer = window.setInterval(maybeLoad, CO_MANAGED_SIGNALS_REFRESH_MS);
    window.addEventListener('focus', maybeLoad);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', maybeLoad);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sponsoring, load]);

  const refresh = useCallback(() => { if (sponsoring) load(); }, [sponsoring, load]);

  const value = useMemo<CoManagedWorkSignalsValue>(() => {
    if (!sponsoring || !data || data.assigned <= 0) return { ...EMPTY_CO_MANAGED_WORK_SIGNALS, viewerId: viewerId ?? null, refresh };
    return {
      available: true,
      viewerId: viewerId ?? null,
      escalatedUnassigned: data.escalatedUnassigned,
      awaitingReply: data.awaitingReply,
      total: data.escalatedUnassigned + data.awaitingReply,
      refresh,
    };
  }, [sponsoring, data, viewerId, refresh]);

  return <CoManagedWorkSignalsContext.Provider value={value}>{children}</CoManagedWorkSignalsContext.Provider>;
}
