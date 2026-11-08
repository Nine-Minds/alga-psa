'use client';

import CoManagedEffort from './CoManagedEffort';
import CoManagedTimeBillingProfile from './CoManagedTimeBillingProfile';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import type { CoManagedEffortTarget } from '@/lib/actions/coManagedTimeActions';

type Props = {
  target: CoManagedEffortTarget;
  /** Bump after a time entry was saved or deleted; the split reloads. */
  refreshKey?: number;
  /** MSP side only: also offer the co-managed billing profile for the shared work. */
  billingProfile?: boolean;
  billingProfileDisabled?: boolean;
};

/**
 * The customer / MSP / combined effort split for `slots.timeSummary` on the native ticket screen. The MSP
 * side targets the qualified shared resource; the customer side its own local ticket or task. Both read
 * through the same admitted totals action, so no authority is added here.
 */
export function CoManagedEffortSummary({ target, refreshKey, billingProfile, billingProfileDisabled }: Props) {
  return <>
    <CoManagedEffort target={target} refreshKey={refreshKey} variant="inline" />
    {billingProfile && target.kind === 'shared' && <CoManagedFeatureBoundary mode="serves">
      <CoManagedTimeBillingProfile resource={target.resource} disabled={!!billingProfileDisabled} onBusyChange={() => {}} />
    </CoManagedFeatureBoundary>}
  </>;
}

export default CoManagedEffortSummary;
