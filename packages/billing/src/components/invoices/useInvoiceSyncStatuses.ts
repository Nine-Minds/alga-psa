'use client';

import { useEffect, useState } from 'react';
import { getInvoiceSyncStatuses } from '../../actions/accountingSyncActions';
import type { InvoiceSyncStatus } from '../../actions/accountingSyncActions';

export interface UseInvoiceSyncStatusesResult {
  /** Map of invoiceId → InvoiceSyncStatus. Empty while loading or when hidden. */
  statuses: Record<string, InvoiceSyncStatus>;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /**
   * True when the action threw a Forbidden / Enterprise Edition error or any
   * other permission error — the column should be suppressed entirely.
   */
  hidden: boolean;
}

/**
 * Fetches sync statuses for a list of invoice IDs, non-blocking.
 * If the action throws (CE / no permission) the `hidden` flag is set and
 * the caller should render no QuickBooks column.
 */
export function useInvoiceSyncStatuses(invoiceIds: string[]): UseInvoiceSyncStatusesResult {
  const [statuses, setStatuses] = useState<Record<string, InvoiceSyncStatus>>({});
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);

  const stableKey = invoiceIds.slice().sort().join(',');

  useEffect(() => {
    if (invoiceIds.length === 0) {
      setStatuses({});
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    getInvoiceSyncStatuses(invoiceIds)
      .then((result) => {
        if (!isMounted) return;
        setStatuses(result);
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        // Any error (Forbidden, Enterprise Edition, network) → hide the column
        setHidden(true);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey]);

  return { statuses, loading, hidden };
}
