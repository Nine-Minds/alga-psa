'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCapability } from '@alga-psa/ui/hooks';
import { useProduct } from '@/context/ProductContext';
import { getCoManagedWorkSignalsAction } from '@/lib/actions/coManagedTicketQueueActions';

export interface CoManagedWorkSignalsValue {
  /** True only when the capability serves this tenant, it sponsors from a PSA workspace, and at least one relationship is staff-assigned. */
  available: boolean;
  escalatedUnassigned: number;
  awaitingReply: number;
  /** Sum of the two signals; hides at zero. */
  total: number;
  /** Re-read the counts after an action that changes them. A no-op while the capability is closed. */
  refresh: () => void;
}

export const EMPTY_CO_MANAGED_WORK_SIGNALS: CoManagedWorkSignalsValue = {
  available: false, escalatedUnassigned: 0, awaitingReply: 0, total: 0, refresh: () => {},
};

const CoManagedWorkSignalsContext = createContext<CoManagedWorkSignalsValue>(EMPTY_CO_MANAGED_WORK_SIGNALS);

export function useCoManagedWorkSignals(): CoManagedWorkSignalsValue {
  return useContext(CoManagedWorkSignalsContext);
}

/**
 * Counts for the All Tickets callout. Presentation only: the capability decides whether
 * to ask at all (closed => no action call, nothing renders); the action authorizes the
 * read regardless. Any failure leaves the context empty.
 */
export function CoManagedWorkSignalsProvider({ children }: { children: React.ReactNode }) {
  const { productCode } = useProduct();
  const { enabled } = useCapability('co-managed');
  const sponsoring = enabled && productCode === 'psa';
  const [data, setData] = useState<{ assigned: number; escalatedUnassigned: number; awaitingReply: number } | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    getCoManagedWorkSignalsAction({})
      .then(result => {
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

  useEffect(() => {
    if (!sponsoring) { generation.current += 1; setData(null); return; }
    load();
    return () => { generation.current += 1; };
  }, [sponsoring, load]);

  const refresh = useCallback(() => { if (sponsoring) load(); }, [sponsoring, load]);

  const value = useMemo<CoManagedWorkSignalsValue>(() => {
    if (!sponsoring || !data || data.assigned <= 0) return { ...EMPTY_CO_MANAGED_WORK_SIGNALS, refresh };
    return {
      available: true,
      escalatedUnassigned: data.escalatedUnassigned,
      awaitingReply: data.awaitingReply,
      total: data.escalatedUnassigned + data.awaitingReply,
      refresh,
    };
  }, [sponsoring, data, refresh]);

  return <CoManagedWorkSignalsContext.Provider value={value}>{children}</CoManagedWorkSignalsContext.Provider>;
}
