import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  recurringBillingRunCompletedEventPayloadSchema,
  recurringBillingRunFailedEventPayloadSchema,
  recurringBillingRunStartedEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/billingEventSchemas';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const RUN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('recurring billing workflow event payloads', () => {
  it('carry explicit service-period-first selection metadata on started and completed events', () => {
    const startedAt = '2026-03-17T12:00:00.000Z';
    const completedAt = '2026-03-17T12:05:00.000Z';

    const startedPayload = buildRecurringBillingRunStartedPayload({
      runId: RUN_ID,
      startedAt,
      initiatedByUserId: USER_ID,
    });
    const completedPayload = buildRecurringBillingRunCompletedPayload({
      runId: RUN_ID,
      completedAt,
      invoicesCreated: 2,
      failedCount: 0,
    });

    expect(startedPayload.selectionMode).toBe('due_service_periods');
    expect(startedPayload.windowIdentity).toBe('billing_cycle_window');
    expect(startedPayload.executionWindowKinds).toBeUndefined();
    expect(completedPayload.selectionMode).toBe('due_service_periods');
    expect(completedPayload.windowIdentity).toBe('billing_cycle_window');
    expect(completedPayload.executionWindowKinds).toBeUndefined();

    recurringBillingRunStartedEventPayloadSchema.parse(
      buildWorkflowPayload(startedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: startedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
    recurringBillingRunCompletedEventPayloadSchema.parse(
      buildWorkflowPayload(completedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: completedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('carries explicit service-period-first selection metadata on failed events', () => {
    const failedAt = '2026-03-17T12:05:00.000Z';
    const failedPayload = buildRecurringBillingRunFailedPayload({
      runId: RUN_ID,
      failedAt,
      errorMessage: 'Billing cycle lookup failed',
      retryable: true,
    });

    expect(failedPayload.selectionMode).toBe('due_service_periods');
    expect(failedPayload.windowIdentity).toBe('billing_cycle_window');
    expect(failedPayload.executionWindowKinds).toBeUndefined();

    recurringBillingRunFailedEventPayloadSchema.parse(
      buildWorkflowPayload(failedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: failedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('allows recurring run workflow metadata to describe mixed client and contract execution-window kinds explicitly', () => {
    const startedAt = '2026-03-17T12:00:00.000Z';
    const payload = buildRecurringBillingRunStartedPayload({
      runId: RUN_ID,
      startedAt,
      initiatedByUserId: USER_ID,
      executionWindowKinds: ['contract_cadence_window', 'billing_cycle_window', 'contract_cadence_window'],
    });

    expect(payload.executionWindowKinds).toEqual([
      'billing_cycle_window',
      'contract_cadence_window',
    ]);

    recurringBillingRunStartedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt: startedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });
});
