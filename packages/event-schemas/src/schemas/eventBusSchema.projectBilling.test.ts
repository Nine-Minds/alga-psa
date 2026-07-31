import { describe, expect, it } from 'vitest';

import { EventSchemas } from './eventBusSchema';
import { workflowEventPayloadSchemas } from './domain/workflowEventPayloadSchemas';

const baseEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  timestamp: '2026-07-15T12:00:00.000Z',
};

describe('project billing event schemas', () => {
  it.each(['phase', 'date', 'manual'] as const)(
    'accepts milestone readiness triggered by %s',
    (trigger) => {
      const result = EventSchemas.PROJECT_MILESTONE_READY.safeParse({
        ...baseEvent,
        eventType: 'PROJECT_MILESTONE_READY',
        payload: {
          tenantId: '00000000-0000-4000-8000-000000000002',
          projectId: '00000000-0000-4000-8000-000000000003',
          entryId: '00000000-0000-4000-8000-000000000004',
          description: 'Design approval',
          computedAmount: 12500,
          trigger,
        },
      });

      expect(result.success).toBe(true);
    },
  );

  it('accepts newly recorded project budget threshold crossings', () => {
    const result = EventSchemas.PROJECT_BUDGET_THRESHOLD_REACHED.safeParse({
      ...baseEvent,
      eventType: 'PROJECT_BUDGET_THRESHOLD_REACHED',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        threshold: 80,
        billed: 80000,
        cap: 100000,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects negative currency amounts', () => {
    const result = EventSchemas.PROJECT_MILESTONE_READY.safeParse({
      ...baseEvent,
      eventType: 'PROJECT_MILESTONE_READY',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        entryId: '00000000-0000-4000-8000-000000000004',
        description: 'Design approval',
        computedAmount: -1,
        trigger: 'manual',
      },
    });

    expect(result.success).toBe(false);
  });

  it('registers the project billing workflow event catalog payload contracts', () => {
    const refs = [
      'payload.ProjectMilestoneReady.v1',
      'payload.ProjectBudgetThresholdReached.v1',
      'payload.ProjectBudgetExceeded.v1',
      'payload.ProjectBillingConfigCreated.v1',
      'payload.ProjectBillingConfigUpdated.v1',
      'payload.ProjectBillingConfigDeleted.v1',
      'payload.ProjectBillingScheduleEntryCreated.v1',
      'payload.ProjectBillingScheduleEntryUpdated.v1',
      'payload.ProjectBillingScheduleStatusChanged.v1',
      'payload.ProjectBillingScheduleEntryDeleted.v1',
      'payload.ProjectBillingPaymentStatusChanged.v1',
    ];
    for (const ref of refs) expect(workflowEventPayloadSchemas[ref]).toBeDefined();
  });

  it('accepts the first hard-cap overage payload and rejects a zero write-down', () => {
    const event = {
      ...baseEvent,
      eventType: 'PROJECT_BUDGET_EXCEEDED' as const,
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        invoiceId: '00000000-0000-4000-8000-000000000004',
        billed: 100000,
        attempted: 102500,
        cap: 100000,
        writtenDown: 2500,
      },
    };
    expect(EventSchemas.PROJECT_BUDGET_EXCEEDED.safeParse(event).success).toBe(true);
    expect(EventSchemas.PROJECT_BUDGET_EXCEEDED.safeParse({
      ...event,
      payload: { ...event.payload, writtenDown: 0 },
    }).success).toBe(false);
  });

  it('accepts schedule status events with the explicit payment prerequisite flag', () => {
    const result = EventSchemas.PROJECT_BILLING_SCHEDULE_STATUS_CHANGED.safeParse({
      ...baseEvent,
      eventType: 'PROJECT_BILLING_SCHEDULE_STATUS_CHANGED',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        configId: '00000000-0000-4000-8000-000000000004',
        entryId: '00000000-0000-4000-8000-000000000005',
        description: 'Deposit',
        status: 'invoiced',
        previousStatus: 'approved',
        requiresPaymentBeforeWork: true,
        userId: '00000000-0000-4000-8000-000000000006',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts flagged payment settlement and reversal state changes', () => {
    const event = {
      ...baseEvent,
      eventType: 'PROJECT_BILLING_PAYMENT_STATUS_CHANGED' as const,
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        configId: '00000000-0000-4000-8000-000000000004',
        entryId: '00000000-0000-4000-8000-000000000005',
        invoiceId: '00000000-0000-4000-8000-000000000006',
        previousState: 'outstanding',
        newState: 'satisfied',
        previousInvoiceStatus: 'sent',
        newInvoiceStatus: 'paid',
        requiresPaymentBeforeWork: true,
        userId: '00000000-0000-4000-8000-000000000007',
      },
    };
    expect(EventSchemas.PROJECT_BILLING_PAYMENT_STATUS_CHANGED.safeParse(event).success).toBe(true);
    expect(EventSchemas.PROJECT_BILLING_PAYMENT_STATUS_CHANGED.safeParse({
      ...event,
      payload: {
        ...event.payload,
        previousState: 'satisfied',
        newState: 'outstanding',
        previousInvoiceStatus: 'paid',
        newInvoiceStatus: 'sent',
      },
    }).success).toBe(true);
  });
});
