'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

export interface CredentialsVaultTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the unified client "Passwords" tab (credentials vault):
 * EE edition AND the `release-v1.5-feature` flag AND the credentials tier.
 * The tier probe is edition-swapped (EE server action; CE stub returns
 * tierOk=false), so any probe failure resolves hidden. Flag off ⇒ the legacy
 * Hudu-only Passwords tab keeps its current registration.
 */
export function useCredentialsVaultTab(): CredentialsVaultTabGate {
  const enabled = isEnterprise;
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  const [tierOk, setTierOk] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled || !flagEnabled) {
      setTierOk(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const { getCredentialsContext } = await import(
          '@enterprise/lib/actions/credentials/credentialActions'
        );
        const result = await getCredentialsContext();
        if (!cancelled) setTierOk(result?.tierOk === true);
      } catch {
        if (!cancelled) setTierOk(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, flagEnabled]);

  return {
    visible: enabled && flagEnabled && tierOk,
    loading: checking,
  };
}
