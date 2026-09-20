'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';

import type { SmartSearchEntity } from './types';

export interface SmartSearchAvailabilityGate {
  available: boolean;
  loading: boolean;
}

/**
 * Whether a list page should offer smart search on its entity: enterprise
 * edition AND the edition-swapped probe says the caller passes every gate
 * (permission, release flag, AI add-on, key). The CE stub always answers
 * unavailable; any probe failure resolves hidden. Mirrors useCredentialsVaultTab.
 */
export function useSmartSearchAvailability(entity: SmartSearchEntity): SmartSearchAvailabilityGate {
  const enabled = isEnterprise;
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const { getSmartSearchAvailability } = await import('@enterprise/lib/actions/smartSearchActions');
        const result = await getSmartSearchAvailability(entity);
        if (!cancelled) setAvailable(result?.available === true);
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, entity]);

  return { available: enabled && available, loading: checking };
}
