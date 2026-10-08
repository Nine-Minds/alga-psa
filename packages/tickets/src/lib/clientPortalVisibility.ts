// Moved to @alga-psa/authorization (portal/visibility). Kept as a re-export so
// existing importers keep working; new code should import from the new home.
export {
  applyTicketVisibilityFilter,
  ticketMatchesVisibility,
  VISIBILITY_GROUP_MISMATCH_ERROR,
  VISIBILITY_GROUP_MISSING_ERROR,
  type ContactVisibilityContext,
  type TicketVisibilityRecord,
} from '@alga-psa/authorization/portal/visibility';
