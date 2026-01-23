import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  recurringBillingRunCompletedEventPayloadSchema,
  recurringBillingRunFailedEventPayloadSchema,
  recurringBillingRunStartedEventPayloadSchema,
} from '../../../runtime/schemas/billingEventSchemas';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '../recurringBillingRunEventBuilders';

describe('recurringBillingRunEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const runId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds RECURRING_BILLING_RUN_STARTED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildRecurringBillingRunStartedPayload({
        runId,
        scheduleId: '3a109f2c-16f1-4caa-bd2f-1295aeae2f78',
        startedAt: occurredAt,
        initiatedByUserId: actorUserId,
      }),
      ctx
    );

    expect(recurringBillingRunStartedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds RECURRING_BILLING_RUN_COMPLETED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildRecurringBillingRunCompletedPayload({
        runId,
        completedAt: occurredAt,
        invoicesCreated: 12,
        failedCount: 3,
        warnings: ['Some invoices were skipped due to validation errors.'],
      }),
      ctx
    );

    expect(recurringBillingRunCompletedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds RECURRING_BILLING_RUN_FAILED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildRecurringBillingRunFailedPayload({
        runId,
        failedAt: occurredAt,
        errorCode: 'BILLING_RUN_FAILED',
        errorMessage: 'Unexpected failure while generating invoices',
        retryable: true,
      }),
      ctx
    );

    expect(recurringBillingRunFailedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

