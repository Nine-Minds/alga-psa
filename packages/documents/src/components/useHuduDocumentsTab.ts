'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

export interface HuduDocumentsTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the Documents page "Hudu" tab (F232): EE edition + the
 * `hudu-integration` feature flag (useHuduClientTab precedent), then a light
 * edition-swapped probe — Hudu connected for the tenant (no client mapping
 * required). Any probe failure resolves hidden.
 */
export function useHuduDocumentsTab(): HuduDocumentsTabGate {
  const flag = useFeatureFlag('hudu-integration', { defaultValue: false });
  const enabled = isEnterprise && !!flag.enabled;

  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const { getHuduConnectionStatus } = await import(
          '@enterprise/lib/actions/integrations/huduActions'
        );
        const result = await getHuduConnectionStatus();
        if (!cancelled) {
          setConnected(result.success === true && result.data.connected === true);
        }
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    visible: enabled && connected === true,
    loading: flag.loading || checking,
  };
}
