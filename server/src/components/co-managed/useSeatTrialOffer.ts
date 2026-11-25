'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSeatTrialOfferAction } from '@enterprise/lib/actions/coManagedSeatTrialActions';
import type { SeatTrialStory } from '@/lib/co-managed/seatEnableStory';

/** What `getSeatTrialOfferAction` returns (Enterprise); the Community stub never has an offer. */
export interface SeatTrialOffer {
  price: { unitAmount: number; currency: string } | null;
  intake: boolean;
  canStart: boolean;
  canPurchase: boolean;
  clientId?: string;
  pilot: {
    trialId: string;
    status: 'pending' | 'active' | 'base_paused' | 'expired' | 'paid' | 'checkout_pending' | 'ended';
    deadline?: string;
    baseUntil?: string;
    conversionFailed: boolean;
    invited: boolean;
    pendingPurchase: { operationId: string; quantity: number } | null;
  } | null;
}

/** The one place an offer becomes a story (plan §3). */
export function deriveSeatTrialStory(offer: SeatTrialOffer | null): SeatTrialStory {
  if (!offer) return 'none';
  if (offer.canStart) return 'available';
  const status = offer.pilot?.status;
  if (!status) return 'none';
  if (status === 'pending') return 'pending';
  // A purchase in flight keeps the trial seat in use until it lands.
  if (status === 'active' || status === 'checkout_pending') return 'active';
  return 'ended';
}

/**
 * The single reader of the seat trial offer for a client (or the tenant, with no client): the offer, its
 * loading state, a `reload()` and the derived story. The trial card and the Enable chooser both take
 * this, so one read and one refresh path feed both.
 */
export function useSeatTrialOffer(clientId?: string) {
  const [offer, setOffer] = useState<SeatTrialOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = (await getSeatTrialOfferAction(clientId)) as SeatTrialOffer | null;
      if (generation.current === current) setOffer(next);
    } catch {
      if (generation.current === current) setOffer(null);
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [clientId]);
  useEffect(() => {
    setOffer(null);
    setLoading(true);
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);
  return { offer, loading, reload, story: deriveSeatTrialStory(offer) };
}
