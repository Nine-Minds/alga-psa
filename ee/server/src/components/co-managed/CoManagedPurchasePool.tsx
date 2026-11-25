'use client';

import CoManagedSeatTrial from './CoManagedSeatTrial';
import { useSeatTrialOffer } from '@/components/co-managed/useSeatTrialOffer';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CoManagedPoolEditor from '@/components/co-managed/CoManagedPoolEditor';
import CoManagedPoolExplainer from '@/components/co-managed/CoManagedPoolExplainer';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';

/**
 * The sponsor's seat pool for an eligible purchaser: verified purchased / allocated / available totals
 * and the existing editor, review and checkout. It reads only `getCoManagedPurchaseState`; no overview
 * or table reader, sponsor admission or allocation action. When verified capacity moves it asks the
 * server to re-render, so the root re-derives access instead of trusting anything the browser holds.
 */
export default function CoManagedPurchasePool({ clientsHref }: { clientsHref?: string }) {
  const router = useRouter();
  const { offer, reload } = useSeatTrialOffer();
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(CO_MANAGED_ACCESS_CHANGED, refresh);
    return () => window.removeEventListener(CO_MANAGED_ACCESS_CHANGED, refresh);
  }, [router]);
  return <><CoManagedSeatTrial offer={offer} onReload={reload} /><CoManagedPoolEditor showTotals explainer={<CoManagedPoolExplainer />} clientsHref={clientsHref} /></>;
}
