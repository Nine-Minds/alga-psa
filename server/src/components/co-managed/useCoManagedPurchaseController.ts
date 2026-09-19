'use client';

import { useCallback, useRef, useState } from 'react';
import { getCoManagedBillingState } from '@/lib/actions/coManagedActions';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '@enterprise/lib/actions/coManagedBillingActions';

export type CoManagedBillingState = Awaited<ReturnType<typeof getCoManagedBillingState>>;
export interface CoManagedPurchaseQuote {
  quantity: number;
  monthlyTotal: number;
  amountDue: number;
  currency: string;
}

/**
 * Shared hosted pool purchase controller. It drives the account pool editor and
 * the contextual client flow from one place: durable operation identity, frozen
 * quantity across ambiguous responses, preview then explicit confirmation, and
 * pending-operation recovery. A browser callback never grants capacity by
 * itself; callers re-read verified state instead.
 */
export function useCoManagedPurchaseController() {
  const [state, setState] = useState<CoManagedBillingState | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState<CoManagedPurchaseQuote | null>(null);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const next = await getCoManagedBillingState();
    setState(next);
    setQuantity(next.pending?.quantity ?? Math.max(1, next.capacity));
    operation.current = next.pending?.operation_id ?? null;
    return next;
  }, []);

  const review = useCallback(async (nextQuantity: number) => {
    setBusy(true); setError(null);
    try {
      const quote = await previewCoManagedSeatsAction(nextQuantity);
      setPreview({ quantity: nextQuantity, monthlyTotal: quote.monthlyTotal, amountDue: quote.amountDue, currency: quote.currency });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'preview');
      return false;
    } finally { setBusy(false); }
  }, []);

  const purchase = useCallback(async (nextQuantity?: number) => {
    const quantityToBuy = nextQuantity ?? preview?.quantity ?? quantity;
    operation.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      const result = await purchaseCoManagedSeatsAction({ quantity: quantityToBuy, operationId: operation.current });
      if (result.kind === 'checkout') {
        if (!result.publishableKey) {
          // A session without a usable publishable key cannot render checkout;
          // keep the pending operation so a repair resumes the same purchase.
          setPreview(null);
          setError('checkoutUnavailable');
          await reload();
          return 'checkout-unavailable' as const;
        }
        setCheckout({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
        return 'checkout' as const;
      }
      setPreview(null); setCheckout(null);
      if (result.kind === 'expired') {
        setError('expired');
        await reload();
        return 'expired' as const;
      }
      return 'updated' as const;
    } catch (err) {
      // The operation identity stays frozen so a retry recovers the same charge.
      setError(err instanceof Error ? err.message : 'purchase');
      await reload().catch(() => undefined);
      return 'ambiguous' as const;
    } finally { setBusy(false); }
  }, [preview, quantity, reload]);

  return { state, quantity, setQuantity, preview, setPreview, checkout, setCheckout, busy, error, setError, reload, review, purchase };
}
