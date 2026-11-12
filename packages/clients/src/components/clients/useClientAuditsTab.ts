'use client';

import { useEffect, useState } from 'react';

export interface ClientAuditsTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the client "Audits" tab: shown only when the current user
 * has asset:read. Probing the permission (rather than inferring it from the
 * composition layer merely supplying a renderer) keeps a permitted-but-never-
 * audited client showing the tab, and keeps a user without asset:read from
 * opening it onto a refusal. Any probe failure resolves hidden.
 *
 * The probe arrives as a callback because it belongs to @alga-psa/assets, which
 * this package may not import — the same seam as `renderClientAudits`.
 */
export function useClientAuditsTab(probe?: () => Promise<boolean>): ClientAuditsTabGate {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(Boolean(probe));

  useEffect(() => {
    if (!probe) {
      setVisible(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const allowed = await probe();
        if (!cancelled) setVisible(allowed === true);
      } catch {
        if (!cancelled) setVisible(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [probe]);

  return { visible, loading };
}
