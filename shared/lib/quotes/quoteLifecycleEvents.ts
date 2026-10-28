import type { QuoteStatus } from '@alga-psa/types';

/** Events correspond to real transitions, not repeated writes of the same status. */
export type QuoteLifecycleEventType =
  | 'QUOTE_SENT'
  | 'QUOTE_APPROVED'
  | 'QUOTE_ACCEPTED'
  | 'QUOTE_REJECTED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_CONVERTED'
  | 'QUOTE_CONVERSION_REVERTED'
  | 'QUOTE_SUPERSEDED'
  | 'QUOTE_CANCELLED';

const eventForStatus: Partial<Record<QuoteStatus, QuoteLifecycleEventType>> = {
  sent: 'QUOTE_SENT',
  approved: 'QUOTE_APPROVED',
  accepted: 'QUOTE_ACCEPTED',
  rejected: 'QUOTE_REJECTED',
  expired: 'QUOTE_EXPIRED',
  converted: 'QUOTE_CONVERTED',
  superseded: 'QUOTE_SUPERSEDED',
  cancelled: 'QUOTE_CANCELLED',
};

/**
 * Classify an already-authorized status transition. The caller is responsible
 * for enforcing the status machine and recording the transition atomically.
 */
export function quoteLifecycleEventFor(
  before: QuoteStatus | null,
  after: QuoteStatus | null,
  details: { system?: boolean } = {},
): QuoteLifecycleEventType | null {
  if (!before || !after || before === after) return null;
  if (before === 'converted' && after === 'accepted') {
    return details.system ? 'QUOTE_CONVERSION_REVERTED' : null;
  }
  return eventForStatus[after] ?? null;
}
