import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  creditNoteAppliedEventPayloadSchema,
  creditNoteCreatedEventPayloadSchema,
  creditNoteVoidedEventPayloadSchema,
} from '../../../runtime/schemas/billingEventSchemas';
import {
  buildCreditNoteAppliedPayload,
  buildCreditNoteCreatedPayload,
  buildCreditNoteVoidedPayload,
} from '../creditNoteEventBuilders';

describe('creditNoteEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const occurredAt = '2026-01-23T12:00:00.000Z';
  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds CREDIT_NOTE_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildCreditNoteCreatedPayload({
        creditNoteId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        clientId: 'd52f0423-23e6-4f88-a1d0-6f47c6b12e95',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
        amount: 2500,
        currency: 'USD',
        status: 'issued',
        sourceDocumentKind: 'negative_invoice',
        sourceInvoiceId: '643a1b92-0c24-4a2c-8b35-61de20efb196',
        sourceInvoiceNumber: 'INV-1001',
        sourceInvoiceStatus: 'sent',
        sourceInvoiceDateBasis: 'canonical_recurring_service_period',
        sourceServicePeriodStart: '2026-01-01T00:00:00.000Z',
        sourceServicePeriodEnd: '2026-02-01T00:00:00.000Z',
      }),
      ctx
    );

    expect(creditNoteCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CREDIT_NOTE_APPLIED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildCreditNoteAppliedPayload({
        creditNoteId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        invoiceId: '643a1b92-0c24-4a2c-8b35-61de20efb196',
        appliedByUserId: actorUserId,
        appliedAt: occurredAt,
        amountApplied: 1200,
        currency: 'USD',
        appliedInvoiceNumber: 'INV-3001',
        appliedInvoiceStatus: 'sent',
        appliedInvoiceDateBasis: 'canonical_recurring_service_period',
        appliedServicePeriodStart: '2026-01-01T00:00:00.000Z',
        appliedServicePeriodEnd: '2026-02-01T00:00:00.000Z',
      }),
      ctx
    );

    expect(creditNoteAppliedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CREDIT_NOTE_VOIDED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildCreditNoteVoidedPayload({
        creditNoteId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        voidedByUserId: actorUserId,
        voidedAt: occurredAt,
        reason: 'invoice_deleted',
      }),
      ctx
    );

    expect(creditNoteVoidedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
