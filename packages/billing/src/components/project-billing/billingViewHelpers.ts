// The status visuals and phase-badge derivation live in @alga-psa/core (both
// billing and projects render them, and feature packages must not import each
// other). Re-exported here for the project-billing components.
import type { IProjectBillingScheduleEntry } from '@alga-psa/types';

export {
  statusVisual,
  phaseBadgeClasses,
  derivePhaseBillingBadges,
  type StatusVisual,
  type PhaseBillingBadge,
} from '@alga-psa/core';

/** Percentage shown in the schedule; frozen dollars remain the source of truth. */
export function getEntryDisplayPercentage(
  entry: Pick<IProjectBillingScheduleEntry, 'percentage' | 'frozen_amount'>,
  totalPrice: number | null,
): number | null {
  if (entry.frozen_amount === null) {
    return entry.percentage;
  }
  if (totalPrice === null || totalPrice <= 0) {
    return null;
  }
  return (entry.frozen_amount / totalPrice) * 100;
}
