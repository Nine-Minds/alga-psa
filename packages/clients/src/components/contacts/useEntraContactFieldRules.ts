'use client';

import { useEffect, useState } from 'react';
import { getEntraIntegrationStatus } from '@alga-psa/integrations/actions';

/**
 * The tenant's field-sync rules, fetched only for contacts that are actually
 * Entra-linked. Contact detail is a shared surface used far beyond Entra, so an
 * unconditional request here would tax every tenant to serve a few.
 *
 * Any failure resolves to no rules, which means no warning — quieter than a
 * wrong warning.
 */
export function useEntraContactFieldRules(
  enabled: boolean
): Record<string, unknown> | null {
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRules(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await getEntraIntegrationStatus();
        if (cancelled || 'error' in result) return;
        setRules((result.data?.fieldSyncConfig as Record<string, unknown>) || null);
      } catch {
        if (!cancelled) setRules(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return rules;
}
