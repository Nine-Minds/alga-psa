'use client';

import { useEffect, useState } from 'react';
import { isEnterprise } from '@alga-psa/core';

export interface CredentialsVaultTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the unified client "Passwords" tab (credentials vault):
 * EE edition AND the credentials tier. The tier probe is edition-swapped (EE
 * server action; CE stub returns tierOk=false), so any probe failure resolves
 * hidden. Gate closed ⇒ the legacy Hudu-only Passwords tab keeps its current
 * registration.
 */
export function useCredentialsVaultTab(): CredentialsVaultTabGate {
  const enabled = isEnterprise;

  const [tierOk, setTierOk] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled]);

  return {
    visible: enabled && tierOk,
    loading: checking,
  };
}
