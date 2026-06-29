'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';

export interface HuduClientTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the client "Hudu" tab (F070): EE edition, then a light
 * edition-swapped probe — Hudu connected AND this client mapped. Any probe
 * failure resolves hidden.
 */
export function useHuduClientTab(clientId: string): HuduClientTabGate {
  const enabled = isEnterprise;

  const [context, setContext] = useState<{ connected: boolean; mapped: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled || !clientId) {
      setContext(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const { getHuduClientContext } = await import(
          '@enterprise/lib/actions/integrations/huduDataActions'
        );
        const result = await getHuduClientContext(clientId);
        if (!cancelled) setContext(result);
      } catch {
        if (!cancelled) setContext({ connected: false, mapped: false });
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  return {
    visible: enabled && context?.connected === true && context?.mapped === true,
    loading: checking,
  };
}
