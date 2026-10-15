'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
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
}

export const EMPTY_CO_MANAGED_WORK_SIGNALS: CoManagedWorkSignalsValue = {
  available: false, viewerId: null, escalatedUnassigned: 0, awaitingReply: 0, total: 0,
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
 * Loads the callout counts once, lazily, after mount. Presentation only: the
 * release flag decides whether to ask at all; the server action authorizes the
 * read regardless. Any failure leaves the context empty (nothing renders).
 */
export function CoManagedWorkSignalsProvider({ viewerId, children }: { viewerId?: string | null; children: React.ReactNode }) {
  const { productCode } = useProduct();
  const { isPro } = useTier();
  const flag = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const flagOn = flag?.enabled === true && !flag.loading && !flag.error;
  const sponsoring = flagOn && productCode === 'psa' && isPro;
  const pathname = usePathname();
  const [data, setData] = useState<{ assigned: number; escalatedUnassigned: number; awaitingReply: number } | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    getCoManagedWorkSignalsAction({})
      .then((result) => {
        if (mine !== generation.current) return;
        if (!result || typeof result !== 'object' || !('signals' in result)) { setData(null); return; }
        setData({
          assigned: result.assignedRelationshipCount ?? 0,
          escalatedUnassigned: result.signals?.escalatedUnassigned ?? 0,
          awaitingReply: result.signals?.awaitingReply ?? 0,
        });
      })
      .catch(() => { if (mine === generation.current) setData(null); });
  }, []);

  // Re-read on navigation (counts move as work is handled); the first read waits for idle.
  useEffect(() => {
    if (!sponsoring) { generation.current += 1; setData(null); return; }
    return afterPaint(load);
  }, [sponsoring, pathname, load]);

  const value = useMemo<CoManagedWorkSignalsValue>(() => {
    if (!sponsoring || !data || data.assigned <= 0) return { ...EMPTY_CO_MANAGED_WORK_SIGNALS, viewerId: viewerId ?? null };
    return {
      available: true,
      viewerId: viewerId ?? null,
      escalatedUnassigned: data.escalatedUnassigned,
      awaitingReply: data.awaitingReply,
      total: data.escalatedUnassigned + data.awaitingReply,
    };
  }, [sponsoring, data, viewerId]);

  return <CoManagedWorkSignalsContext.Provider value={value}>{children}</CoManagedWorkSignalsContext.Provider>;
}
