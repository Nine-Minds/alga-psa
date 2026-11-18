import { describe, expect, it } from 'vitest';
import * as builders from './quoteEventBuilders';
import * as schemas from '../../../../packages/event-schemas/src/schemas/domain/quoteEventSchemas';

const id = '73bf2fee-e5ca-4b28-bafa-e5a05f02a0b1';
const at = '2026-10-27T12:00:00.000Z';
const common = { quoteId: id, quoteNumber: 'Q-1', version: 1, clientId: id, previousStatus: 'sent', newStatus: 'accepted', currencyCode: 'USD', totalAmount: 1200, performedByType: 'SYSTEM' as const };
const extras = {
  Sent: { sentAt: at }, Viewed: { viewedAt: at }, Approved: { approvedAt: at },
  Accepted: { acceptedAt: at, acceptedByName: null, acceptedOnBehalf: false, selectedOptionalItemIds: [id] },
  Rejected: { rejectedAt: at, rejectionReason: null }, Expired: { expiredAt: at },
  Converted: { convertedAt: at, conversionTargets: ['invoice'], invoiceId: id },
  ConversionReverted: { conversionRevertedAt: at, releasedInvoiceId: id },
  Superseded: { supersededAt: at, supersededByQuoteId: id, nextVersion: 2 }, Cancelled: { cancelledAt: at },
};

describe('quote workflow event contracts', () => {
  it.each(Object.entries(extras))('validates the %s builder against its schema', (name, fields) => {
    const build = (builders as Record<string, (p: any) => object>)[`buildQuote${name}Payload`];
    const schema = (schemas as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[`quote${name}EventPayloadSchema`];
    const payload = build({ ...common, ...fields });
    expect(schema.safeParse({ ...payload, tenantId: id, occurredAt: at }).success).toBe(true);
  });
  it('rejects item bodies in the accepted payload', () => {
    expect(schemas.quoteAcceptedEventPayloadSchema.safeParse({ ...common, tenantId: id, occurredAt: at, ...extras.Accepted, selectedOptionalItemIds: [{ id }] }).success).toBe(false);
  });
});
