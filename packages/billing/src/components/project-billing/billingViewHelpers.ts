// The status visuals and phase-badge derivation live in @alga-psa/core (both
// billing and projects render them, and feature packages must not import each
// other). Re-exported here for the project-billing components.
export {
  formatCents,
  statusVisual,
  phaseBadgeClasses,
  derivePhaseBillingBadges,
  type StatusVisual,
  type PhaseBillingBadge,
} from '@alga-psa/core';
