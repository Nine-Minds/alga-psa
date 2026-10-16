// Shim: the portal-visibility layer lives in @alga-psa/authorization.
export {
  applyTicketVisibilityFilter,
  ticketMatchesVisibility,
  VISIBILITY_GROUP_MISMATCH_ERROR,
  VISIBILITY_GROUP_MISSING_ERROR,
  type ContactVisibilityContext,
} from '@alga-psa/authorization/portal/visibility';
export { getClientContactVisibilityContext } from '@alga-psa/authorization/portal/visibility.server';
