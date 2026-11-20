'use client';

import type { CoManagedPurchaseBlockedReason } from '@alga-psa/licensing';
import { useCallback, useRef, useState } from 'react';
import { getCoManagedPurchaseState } from '@/lib/actions/coManagedActions';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '@enterprise/lib/actions/coManagedBillingActions';
import { newCoManagedOperationId } from './coManagedOperationId';

export type CoManagedBillingState = NonNullable<Awaited<ReturnType<typeof getCoManagedPurchaseState>>>;
export interface CoManagedPurchaseQuote {
  quantity: number;
  monthlyTotal: number;
  amountDue: number;
  currency: string;
  /** The offer version the purchaser reviewed; sent back so a rotation forces a fresh review. */
  offerRef?: string;
}

export type CoManagedPreviewProblem = CoManagedPurchaseBlockedReason | 'unexpected';

/**
 * Shared hosted pool purchase controller. It drives the account pool editor and
 * the contextual client flow from one place: durable operation identity, frozen
 * quantity across ambiguous responses, preview then explicit confirmation, and
 * pending-operation recovery. A browser callback never grants capacity by
 * itself; callers re-read verified state instead.
 */
export function useCoManagedPurchaseController(options: {
  confirm?: (input: { operationId: string; quantity: number }, quote: CoManagedPurchaseQuote | null) => ReturnType<typeof purchaseCoManagedSeatsAction>;
  /** Called before the purchase request leaves the browser, so a caller can record the operation it is about to start. */
  onOperation?: (operation: { operationId: string; quantity: number }) => void;
} = {}) {
  const [state, setState] = useState<CoManagedBillingState | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState<CoManagedPurchaseQuote | null>(null);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [previewProblem, setPreviewProblem] = useState<CoManagedPreviewProblem | null>(null);
  /** True once the server answered that the purchase surface is closed (kill switch, flag, price, product). */
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const next = await getCoManagedPurchaseState();
    setClosed(!next);
    if (!next) { setState(null); return null; }
    setState(next);
    setQuantity(next.purchase.pending?.quantity ?? Math.max(1, next.capacity));
    operation.current = next.purchase.pending?.operationId ?? null;
    return next;
  }, []);

  const review = useCallback(async (nextQuantity: number) => {
    setBusy(true); setError(null); setPreviewProblem(null);
    try {
      const result = await previewCoManagedSeatsAction(nextQuantity);
      if (result.kind === 'blocked') {
        setPreview(null);
        setPreviewProblem(result.reason);
        setError(result.reason);
        return false;
      }
      const quote = result;
      setPreviewProblem(null);
      setPreview({ quantity: nextQuantity, monthlyTotal: quote.monthlyTotal, amountDue: quote.amountDue, currency: quote.currency, offerRef: quote.offerRef });
      return true;
    } catch {
      setPreview(null);
      setPreviewProblem('unexpected');
      setError('preview');
      return false;
    } finally { setBusy(false); }
  }, []);

  const clearPreviewProblem = useCallback(() => {
    setPreviewProblem(null);
    setError(null);
  }, []);

  const purchase = useCallback(async (nextQuantity?: number) => {
    // A replay already has a durable operation identity. A new purchase must have a live reviewed quote.
    if (!preview && !operation.current) {
      setError('preview');
      return 'review-required' as const;
    }
    const quantityToBuy = nextQuantity ?? preview?.quantity ?? quantity;
    operation.current ??= newCoManagedOperationId();
    options.onOperation?.({ operationId: operation.current, quantity: quantityToBuy });
    setBusy(true); setError(null);
    try {
      const input = { quantity: quantityToBuy, operationId: operation.current };
      const result = options.confirm
        ? await options.confirm(input, preview)
        : await purchaseCoManagedSeatsAction({ ...input, ...(preview?.offerRef ? { offerRef: preview.offerRef } : {}) });
      if (result.kind === 'review_required') {
        // The price changed after review. Nothing was charged; show the new terms for fresh consent.
        operation.current = null;
        setCheckout(null);
        if (await review(quantityToBuy)) setError('termsChanged');
        return 'review-required' as const;
      }
      if (result.kind === 'unavailable') {
        setPreview(null); setCheckout(null);
        setError('offerUnavailable');
        return 'unavailable' as const;
      }
      if (result.kind === 'checkout') {
        if (!result.publishableKey) {
          // A session without a usable publishable key cannot render checkout;
          // keep the pending operation so a repair resumes the same purchase.
          setPreview(null);
          setError('checkoutUnavailable');
          if (!options.confirm) await reload();
          return 'checkout-unavailable' as const;
        }
        setCheckout({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
        return 'checkout' as const;
      }
      setPreview(null); setCheckout(null);
      if (result.kind === 'expired') {
        setError('expired');
        if (!options.confirm) await reload();
        return 'expired' as const;
      }
      return 'updated' as const;
    } catch {
      // The operation identity stays frozen so a retry recovers the same charge.
      setError('purchase');
      if (!options.confirm) await reload().catch(() => undefined);
      return 'ambiguous' as const;
    } finally { setBusy(false); }
  }, [preview, quantity, reload, review, options.onOperation, options.confirm]);

  /** Replays an operation this browser already started. The server answers from the operation, so it cannot charge twice. */
  const replay = useCallback((operationId: string, replayQuantity: number) => {
    operation.current = operationId;
    return purchase(replayQuantity);
  }, [purchase]);

  const startNewReview = (quote: CoManagedPurchaseQuote) => {
    operation.current = null;
    setError(null); setCheckout(null); setPreview(quote);
  };
  return { startNewReview, state, closed, quantity, setQuantity, preview, setPreview, previewProblem, clearPreviewProblem, checkout, setCheckout, busy, error, setError, reload, review, purchase, replay };
}
