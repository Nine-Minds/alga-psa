import {
  buildQuoteSentPayload,
  buildQuoteViewedPayload,
  buildQuoteApprovedPayload,
  buildQuoteAcceptedPayload,
  buildQuoteRejectedPayload,
  buildQuoteExpiredPayload,
  buildQuoteConvertedPayload,
  buildQuoteConversionRevertedPayload,
  buildQuoteSupersededPayload,
  buildQuoteCancelledPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts, CoveredEntry } from '../registryTypes';
import { IDS, NOW } from '../fixtures';

const base = {
  quoteId: '33333333-3333-4333-8333-333333333333',
  quoteNumber: 'Q-1',
  version: 1,
  clientId: IDS.client,
  previousStatus: 'sent',
  newStatus: 'accepted',
  currencyCode: 'USD',
  totalAmount: 1200,
  performedByType: 'USER' as const,
  performedById: IDS.user,
};
const probe = (build: () => Record<string, unknown>): CoveredEntry => ({
  status: 'covered',
  cases: [
    {
      site: 'shared/workflow/streams/domainEventBuilders/quoteEventBuilders.ts',
      ctx: { occurredAt: NOW },
      build,
    },
  ],
});

export const quoteContracts = {
  QUOTE_SENT: probe(() => buildQuoteSentPayload({ ...base, sentAt: NOW })),
  QUOTE_VIEWED: probe(() =>
    buildQuoteViewedPayload({ ...base, viewedAt: NOW })
  ),
  QUOTE_APPROVED: probe(() =>
    buildQuoteApprovedPayload({ ...base, approvedAt: NOW })
  ),
  QUOTE_ACCEPTED: probe(() =>
    buildQuoteAcceptedPayload({
      ...base,
      acceptedAt: NOW,
      acceptedByName: 'Alex',
      acceptedOnBehalf: false,
      selectedOptionalItemIds: [],
    })
  ),
  QUOTE_REJECTED: probe(() =>
    buildQuoteRejectedPayload({
      ...base,
      rejectedAt: NOW,
      rejectionReason: 'Budget',
    })
  ),
  QUOTE_EXPIRED: probe(() =>
    buildQuoteExpiredPayload({ ...base, expiredAt: NOW })
  ),
  QUOTE_CONVERTED: probe(() =>
    buildQuoteConvertedPayload({
      ...base,
      convertedAt: NOW,
      conversionTargets: ['invoice'],
      invoiceId: IDS.invoice,
    })
  ),
  QUOTE_CONVERSION_REVERTED: probe(() =>
    buildQuoteConversionRevertedPayload({
      ...base,
      conversionRevertedAt: NOW,
      releasedInvoiceId: IDS.invoice,
    })
  ),
  QUOTE_SUPERSEDED: probe(() =>
    buildQuoteSupersededPayload({
      ...base,
      supersededAt: NOW,
      supersededByQuoteId: IDS.opportunity,
      nextVersion: 2,
    })
  ),
  QUOTE_CANCELLED: probe(() =>
    buildQuoteCancelledPayload({ ...base, cancelledAt: NOW })
  ),
} satisfies Pick<
  EmitterContracts,
  | 'QUOTE_SENT'
  | 'QUOTE_VIEWED'
  | 'QUOTE_APPROVED'
  | 'QUOTE_ACCEPTED'
  | 'QUOTE_REJECTED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_CONVERTED'
  | 'QUOTE_CONVERSION_REVERTED'
  | 'QUOTE_SUPERSEDED'
  | 'QUOTE_CANCELLED'
>;
