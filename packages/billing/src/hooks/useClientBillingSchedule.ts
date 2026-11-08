'use client';

import { useEffect, useState } from 'react';
import { getClientBillingCycleAnchor } from '@alga-psa/billing/actions/billingCycleAnchorActions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { FirstInvoiceClientSchedule } from '../lib/firstInvoiceDate';

export type ClientBillingScheduleState = {
  /** True while a fetch for the current `clientId` is outstanding. */
  isLoading: boolean;
  /** The client's billing cycle and anchor, or `null` if there is none to load or the fetch failed/was forbidden. */
  schedule: FirstInvoiceClientSchedule | null;
};

type InternalState =
  | { status: 'idle' }
  | { status: 'loading'; clientId: string }
  | { status: 'ready'; clientId: string; schedule: FirstInvoiceClientSchedule | null };

/**
 * Loads the client's billing schedule once per call site. Surfaces call this
 * once and pass the result down to rows/editors, so nothing fetches per row.
 * A failed or forbidden fetch resolves to `schedule: null` (callers then show
 * no date) rather than a guessed one. Pass `enabled: false` to skip the fetch.
 */
export function useClientBillingSchedule(
  clientId: string | null | undefined,
  enabled: boolean = true,
): ClientBillingScheduleState {
  const [state, setState] = useState<InternalState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled || !clientId) {
      setState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', clientId });
    getClientBillingCycleAnchor(clientId)
      .then((config) => {
        if (cancelled) return;
        const usable = !isActionMessageError(config) && !isActionPermissionError(config);
        setState({
          status: 'ready',
          clientId,
          schedule: usable ? { billingCycle: config.billingCycle, anchor: config.anchor } : null,
        });
      })
      .catch((error) => {
        console.error('Failed to load client billing schedule', error);
        if (!cancelled) {
          setState({ status: 'ready', clientId, schedule: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  const isLoading = enabled && !!clientId && (state.status !== 'ready' || state.clientId !== clientId);
  const schedule = state.status === 'ready' && state.clientId === clientId ? state.schedule : null;
  return { isLoading, schedule };
}
