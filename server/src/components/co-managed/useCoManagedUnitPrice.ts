'use client';

import { useEffect, useState } from 'react';
import { previewCoManagedSeatsAction } from '@enterprise/lib/actions/coManagedBillingActions';

/** Per-seat monthly price in the configured price's minor units and currency. */
export interface CoManagedUnitPrice { unitAmount: number; currency: string }

/**
 * The live price for the quantity control. It reuses the existing purchase preview and calls it once
 * per `probeQuantity`, never per keystroke: seats are priced linearly (the server computes
 * `monthlyTotal = unitAmount × quantity`), so every quantity the stepper shows is derived from the one
 * unit amount. Any failure leaves the price unknown (null); the review step keeps its own
 * `previewError` handling, so a missing price never blocks or misquotes a purchase.
 */
export function useCoManagedUnitPrice(enabled: boolean, probeQuantity: number): CoManagedUnitPrice | null {
  const [price, setPrice] = useState<CoManagedUnitPrice | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    previewCoManagedSeatsAction(Math.max(1, probeQuantity)).then((result) => {
      if (!current) return;
      setPrice(result.kind === 'quote' && Number.isFinite(result.unitAmount) && result.currency
        ? { unitAmount: result.unitAmount, currency: result.currency } : null);
    }, () => { if (current) setPrice(null); });
    return () => { current = false; };
  }, [enabled, probeQuantity]);
  return price;
}
