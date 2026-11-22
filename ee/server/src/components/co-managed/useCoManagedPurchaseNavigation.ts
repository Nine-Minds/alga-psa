'use client';

import { useEffect, useState } from 'react';
import { Handshake } from 'lucide-react';
import type { NavigationSection } from '@/config/menuConfig';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';
import { getCoManagedPurchaseDiscoveryAction } from '../../lib/actions/coManagedPurchaseDiscoveryActions';

/**
 * Navigation contribution for first-purchase discovery: the overview root only, and no permission
 * requirement (the commercial decision is the server's, and `co_management:read` is not granted just to
 * show a link). The archive row is deliberately absent; it keeps its own independent gate.
 */
export const CO_MANAGED_PURCHASE_MENU_GROUP: NavigationSection = {
  id: 'co-managed-purchase',
  title: '',
  items: [{ name: 'Co-managed IT', translationKey: 'nav.coManaged', icon: Handshake, href: '/msp/co-managed' }],
};

/**
 * Resolves the server's commercial decision and returns the contribution when open.
 * A re-read never drops an already visible link: it only moves on a definite answer, so refreshing
 * access after a purchase does not blink the entry out.
 */
export function useCoManagedPurchaseNavigation(): NavigationSection | null {
  const [eligible, setEligible] = useState(false);
  useEffect(() => {
    let mounted = true;
    const load = () => {
      getCoManagedPurchaseDiscoveryAction().then(
        (answer) => { if (mounted && typeof answer === 'boolean') setEligible(answer); },
        () => undefined,
      );
    };
    load();
    window.addEventListener(CO_MANAGED_ACCESS_CHANGED, load);
    return () => { mounted = false; window.removeEventListener(CO_MANAGED_ACCESS_CHANGED, load); };
  }, []);
  return eligible ? CO_MANAGED_PURCHASE_MENU_GROUP : null;
}
