import type { QuoteStatus } from '@alga-psa/types';

export const QUOTE_ALLOWED_STATUS_TRANSITIONS: Record<
  QuoteStatus,
  QuoteStatus[]
> = {
  // `archived` is the terminal "put it away" state offered as the alternative
  // when a hard delete is refused (deletionValidation supportsArchive), so it
  // has to be reachable from every status a caller may want to retire.
  draft: ['pending_approval', 'sent', 'cancelled', 'archived'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: ['converted', 'cancelled'],
  rejected: ['cancelled', 'archived'],
  expired: ['cancelled', 'archived'],
  converted: [],
  cancelled: ['archived'],
  superseded: [],
  archived: [],
};

export function canTransitionQuoteStatus(
  currentStatus: QuoteStatus,
  nextStatus: QuoteStatus
): boolean {
  return (
    currentStatus === nextStatus ||
    QUOTE_ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ===
      true
  );
}
