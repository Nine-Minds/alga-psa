'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { hasSeatTrialRecoveryAction } from '@enterprise/lib/actions/coManagedSeatTrialRecovery';

const storageKey = 'co-managed-seat-trial-return';

/** Carry an authorized client reference across the ordinary base-license checkout. Browser
 * storage only remembers navigation. The sponsor action checks the current binding again. */
export default function SeatTrialReturn({ afterPurchase = false }: { afterPurchase?: boolean }) {
  const router = useRouter();
  const [href, setHref] = useState<string>();
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('seatTrialClient') || sessionStorage.getItem(storageKey);
    if (!target) return;
    let current = true;
    void hasSeatTrialRecoveryAction(target).then(allowed => {
      if (!current) return;
      if (!allowed) { sessionStorage.removeItem(storageKey); return; }
      const url = '/msp/clients/' + encodeURIComponent(target) + '?tab=co-managed';
      if (afterPurchase) {
        sessionStorage.removeItem(storageKey);
        router.replace(url);
      } else {
        sessionStorage.setItem(storageKey, target);
        setHref(url);
      }
    }).catch(() => {});
    return () => { current = false; };
  }, [afterPurchase, router]);
  return href ? <Link id="account-return-to-seat-trial" href={href}
    onClick={() => sessionStorage.removeItem(storageKey)}>Return to client Seat trial</Link> : null;
}
