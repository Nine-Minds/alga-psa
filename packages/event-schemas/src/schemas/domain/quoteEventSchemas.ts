import { z } from 'zod';
import { BaseDomainEventPayloadSchema, currencySchema, entityIdSchema, uuidSchema } from './commonEventPayloadSchemas';

const quoteEventBase = BaseDomainEventPayloadSchema.extend({
  quoteId: uuidSchema('Quote ID'), quoteNumber: z.string().nullable(), version: z.number().int().positive(),
  clientId: entityIdSchema('Client ID', 'client').nullable(), contactId: entityIdSchema('Contact ID', 'contact').optional(),
  opportunityId: uuidSchema('Opportunity ID').optional(), previousStatus: z.string().min(1), newStatus: z.string().min(1),
  currencyCode: currencySchema, totalAmount: z.number().int(),
  performedByType: z.enum(['USER', 'CONTACT', 'SYSTEM']), performedById: uuidSchema('Performer ID').optional(),
});

export const quoteSentEventPayloadSchema = quoteEventBase.extend({ sentAt: z.string().datetime() });

export const quoteViewedEventPayloadSchema = quoteEventBase.extend({ viewedAt: z.string().datetime() });

export const quoteApprovedEventPayloadSchema = quoteEventBase.extend({ approvedAt: z.string().datetime() });

export const quoteAcceptedEventPayloadSchema = quoteEventBase.extend({ acceptedAt: z.string().datetime(), acceptedByName: z.string().nullable(), acceptedOnBehalf: z.boolean(), selectedOptionalItemIds: z.array(uuidSchema('Quote item ID')) });

export const quoteRejectedEventPayloadSchema = quoteEventBase.extend({ rejectedAt: z.string().datetime(), rejectionReason: z.string().nullable() });

export const quoteExpiredEventPayloadSchema = quoteEventBase.extend({ expiredAt: z.string().datetime() });

export const quoteConvertedEventPayloadSchema = quoteEventBase.extend({ convertedAt: z.string().datetime(), conversionTargets: z.array(z.enum(['contract', 'invoice', 'sales_order'])).min(1), contractId: entityIdSchema('Contract ID', 'contract').optional(), invoiceId: uuidSchema('Invoice ID').optional(), salesOrderId: uuidSchema('Sales order ID').optional() });

export const quoteConversionRevertedEventPayloadSchema = quoteEventBase.extend({ conversionRevertedAt: z.string().datetime(), releasedInvoiceId: uuidSchema('Released invoice ID') });

export const quoteSupersededEventPayloadSchema = quoteEventBase.extend({ supersededAt: z.string().datetime(), supersededByQuoteId: uuidSchema('Superseding quote ID'), nextVersion: z.number().int().positive() });

export const quoteCancelledEventPayloadSchema = quoteEventBase.extend({ cancelledAt: z.string().datetime() });
