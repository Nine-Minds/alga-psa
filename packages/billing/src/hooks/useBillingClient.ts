'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IClient } from '@alga-psa/types';
import { getClientByIdForBilling } from '../actions/billingClientsActions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface LoadedBillingClient {
  clientId: string;
  client: IClient | null;
  error: unknown;
}

export interface UseBillingClientResult {
  /** The client for `clientId`, or null while loading, when unset, or when it was not found. */
  client: IClient | null;
  isLoading: boolean;
  /** The failure from the last lookup of the current id (a returned action error or a throw). */
  error: unknown;
  /** Seed the cache with a client the caller already has (e.g. a quick-added one), skipping the lookup. */
  prime: (client: IClient) => void;
}

/**
 * Details of the one client a billing screen has selected (currency, region, name), looked up
 * by id. Billing screens use the async ClientPicker, so they no longer hold a tenant client
 * list to read these from.
 *
 * Results are keyed by client id, so a slow response for a previously selected client is
 * ignored and can never be applied to the current selection.
 */
export function useBillingClient(clientId: string | null | undefined): UseBillingClientResult {
  const [loaded, setLoaded] = useState<LoadedBillingClient | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await getClientByIdForBilling(clientId);
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setLoaded({ clientId, client: null, error: result });
          return;
        }
        setLoaded({ clientId, client: result, error: null });
      } catch (error) {
        if (!cancelled) setLoaded({ clientId, client: null, error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const prime = useCallback((client: IClient) => {
    setLoaded({ clientId: client.client_id, client, error: null });
  }, []);

  const current = clientId && loaded?.clientId === clientId ? loaded : null;
  return {
    client: current?.client ?? null,
    isLoading: Boolean(clientId) && current === null,
    error: current?.error ?? null,
    prime,
  };
}
