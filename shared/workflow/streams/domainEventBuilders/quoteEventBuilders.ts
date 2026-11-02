import { builtWorkflowPayload } from '@alga-psa/event-schemas';
import type { z } from 'zod';
import type {
  quoteSentEventPayloadSchema,
  quoteViewedEventPayloadSchema,
  quoteApprovedEventPayloadSchema,
  quoteAcceptedEventPayloadSchema,
  quoteRejectedEventPayloadSchema,
  quoteExpiredEventPayloadSchema,
  quoteConvertedEventPayloadSchema,
  quoteConversionRevertedEventPayloadSchema,
  quoteSupersededEventPayloadSchema,
  quoteCancelledEventPayloadSchema,
} from '@alga-psa/event-schemas';

export const buildQuoteSentPayload = (params: Omit<z.infer<typeof quoteSentEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_SENT', { ...params });
export const buildQuoteViewedPayload = (params: Omit<z.infer<typeof quoteViewedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_VIEWED', { ...params });
export const buildQuoteApprovedPayload = (params: Omit<z.infer<typeof quoteApprovedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_APPROVED', { ...params });
export const buildQuoteAcceptedPayload = (params: Omit<z.infer<typeof quoteAcceptedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_ACCEPTED', { ...params });
export const buildQuoteRejectedPayload = (params: Omit<z.infer<typeof quoteRejectedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_REJECTED', { ...params });
export const buildQuoteExpiredPayload = (params: Omit<z.infer<typeof quoteExpiredEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_EXPIRED', { ...params });
export const buildQuoteConvertedPayload = (params: Omit<z.infer<typeof quoteConvertedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_CONVERTED', { ...params });
export const buildQuoteConversionRevertedPayload = (params: Omit<z.infer<typeof quoteConversionRevertedEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_CONVERSION_REVERTED', { ...params });
export const buildQuoteSupersededPayload = (params: Omit<z.infer<typeof quoteSupersededEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_SUPERSEDED', { ...params });
export const buildQuoteCancelledPayload = (params: Omit<z.infer<typeof quoteCancelledEventPayloadSchema>, 'tenantId' | 'occurredAt'>) => builtWorkflowPayload('QUOTE_CANCELLED', { ...params });
