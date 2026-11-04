import type { QuoteStatus } from '@alga-psa/types';

export const QUOTE_ALLOWED_STATUS_TRANSITIONS: Record<
  QuoteStatus,
  QuoteStatus[]
> = {
  draft: ['pending_approval', 'sent', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: ['converted', 'cancelled'],
  rejected: ['cancelled'],
  expired: ['cancelled'],
  converted: [],
  cancelled: [],
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
