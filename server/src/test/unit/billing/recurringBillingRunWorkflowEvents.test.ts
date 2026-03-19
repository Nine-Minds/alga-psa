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
  it('default to canonical mixed execution-window metadata when a specific window kind is not supplied', () => {
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
    expect(startedPayload.windowIdentity).toBe('mixed_execution_windows');
    expect(startedPayload.executionWindowKinds).toBeUndefined();
    expect(completedPayload.selectionMode).toBe('due_service_periods');
    expect(completedPayload.windowIdentity).toBe('mixed_execution_windows');
    expect(completedPayload.executionWindowKinds).toBeUndefined();

    recurringBillingRunStartedEventPayloadSchema.parse(
      buildWorkflowPayload(startedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: startedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      }),
    );
    recurringBillingRunCompletedEventPayloadSchema.parse(
      buildWorkflowPayload(completedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: completedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      }),
    );
  });

  it('carry canonical mixed execution-window metadata on failed events by default', () => {
    const failedAt = '2026-03-17T12:05:00.000Z';
    const failedPayload = buildRecurringBillingRunFailedPayload({
      runId: RUN_ID,
      failedAt,
      errorMessage: 'Recurring service period lookup failed',
      retryable: true,
    });

    expect(failedPayload.selectionMode).toBe('due_service_periods');
    expect(failedPayload.windowIdentity).toBe('mixed_execution_windows');
    expect(failedPayload.executionWindowKinds).toBeUndefined();

    recurringBillingRunFailedEventPayloadSchema.parse(
      buildWorkflowPayload(failedPayload as any, {
        tenantId: TENANT_ID,
        occurredAt: failedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      }),
    );
  });

  it('allows workflow metadata to describe mixed client and contract execution-window kinds explicitly', () => {
    const startedAt = '2026-03-17T12:00:00.000Z';
    const payload = buildRecurringBillingRunStartedPayload({
      runId: RUN_ID,
      startedAt,
      initiatedByUserId: USER_ID,
      executionWindowKinds: [
        'contract_cadence_window',
        'client_cadence_window',
        'contract_cadence_window',
      ],
      windowIdentity: 'mixed_execution_windows',
    });

    expect(payload.executionWindowKinds).toEqual([
      'client_cadence_window',
      'contract_cadence_window',
    ]);

    recurringBillingRunStartedEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt: startedAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      }),
    );
  });
});
