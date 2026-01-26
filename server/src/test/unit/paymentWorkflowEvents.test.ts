import { describe, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  paymentAppliedEventPayloadSchema,
  paymentFailedEventPayloadSchema,
  paymentRecordedEventPayloadSchema,
  paymentRefundedEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/billingEventSchemas';
import {
  buildPaymentAppliedPayload,
  buildPaymentFailedPayload,
  buildPaymentRecordedPayload,
  buildPaymentRefundedPayload,
} from '../../lib/api/services/paymentWorkflowEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const INVOICE_ID = '11111111-1111-1111-1111-111111111111';
const PAYMENT_ID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';

describe('payment workflow event payload builders', () => {
  it('builds PAYMENT_RECORDED payloads that validate', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const payload = buildPaymentRecordedPayload({
      paymentId: PAYMENT_ID,
      clientId: CLIENT_ID,
      receivedAt: occurredAt,
      amount: 12345,
      currency: 'USD',
      method: 'manual',
      receivedByUserId: USER_ID,
      gatewayTransactionId: 'ref_123',
    });

    paymentRecordedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('builds PAYMENT_APPLIED payloads that validate', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const payload = buildPaymentAppliedPayload({
      paymentId: PAYMENT_ID,
      appliedAt: occurredAt,
      appliedByUserId: USER_ID,
      applications: [{ invoiceId: INVOICE_ID, amountApplied: 12345 }],
    });

    paymentAppliedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('builds PAYMENT_FAILED payloads that validate', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const payload = buildPaymentFailedPayload({
      invoiceId: INVOICE_ID,
      clientId: CLIENT_ID,
      failedAt: occurredAt,
      amount: 12345,
      currency: 'USD',
      method: 'stripe',
      failureCode: 'card_declined',
      failureMessage: 'The card was declined',
      retryable: true,
    });

    paymentFailedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt,
        actor: { actorType: 'SYSTEM' },
      })
    );
  });

  it('builds PAYMENT_REFUNDED payloads that validate', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const payload = buildPaymentRefundedPayload({
      paymentId: PAYMENT_ID,
      refundedAt: occurredAt,
      refundedByUserId: USER_ID,
      amount: 5000,
      currency: 'USD',
      reason: 'customer request',
    });

    paymentRefundedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });
});

