'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';

export interface SmartTicketSearchAvailabilityGate {
  available: boolean;
  loading: boolean;
}

/**
 * Whether the Tickets page should offer smart search: enterprise edition AND
 * the edition-swapped probe says a TypeSafe key is configured and the caller
 * can read tickets. The CE stub always answers unavailable; any probe failure
 * resolves hidden. Mirrors useCredentialsVaultTab.
 */
export function useSmartTicketSearchAvailability(): SmartTicketSearchAvailabilityGate {
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
        const { getSmartTicketSearchAvailability } = await import(
          '@enterprise/lib/actions/smartTicketSearchActions'
        );
        const result = await getSmartTicketSearchAvailability();
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
  }, [enabled]);

  return { available: enabled && available, loading: checking };
}
