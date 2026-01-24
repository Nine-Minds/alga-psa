import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  contractCreatedEventPayloadSchema,
  contractRenewalUpcomingEventPayloadSchema,
  contractStatusChangedEventPayloadSchema,
  contractUpdatedEventPayloadSchema,
} from '../../../runtime/schemas/billingEventSchemas';
import {
  buildContractCreatedPayload,
  buildContractRenewalUpcomingPayload,
  buildContractStatusChangedPayload,
  buildContractUpdatedPayload,
  computeContractRenewalUpcoming,
} from '../contractEventBuilders';

describe('contractEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const contractId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const clientId = 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds CONTRACT_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContractCreatedPayload({
        contractId,
        clientId,
        createdAt: occurredAt,
        createdByUserId: actorUserId,
        startDate: '2026-02-01',
        endDate: '2026-12-31',
        status: 'active',
      }),
      ctx
    );

    expect(contractCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CONTRACT_UPDATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContractUpdatedPayload({
        contractId,
        clientId,
        updatedAt: occurredAt,
        updatedFields: ['startDate', 'poNumber'],
        changes: {
          startDate: { previous: '2026-01-01', new: '2026-02-01' },
          poNumber: { previous: null, new: 'PO-123' },
        },
      }),
      ctx
    );

    expect(contractUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CONTRACT_STATUS_CHANGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContractStatusChangedPayload({
        contractId,
        clientId,
        previousStatus: 'draft',
        newStatus: 'active',
        changedAt: occurredAt,
      }),
      ctx
    );

    expect(contractStatusChangedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('computes CONTRACT_RENEWAL_UPCOMING timing and builds payloads compatible with schema', () => {
    const computed = computeContractRenewalUpcoming({
      now: '2026-01-01T00:00:00.000Z',
      renewalAt: '2026-01-15',
      windowDays: 30,
    });

    expect(computed).toEqual({ renewalAt: '2026-01-15', daysUntilRenewal: 14 });

    const payload = buildWorkflowPayload(
      buildContractRenewalUpcomingPayload({ contractId, clientId, ...computed! }),
      ctx
    );

    expect(contractRenewalUpcomingEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

