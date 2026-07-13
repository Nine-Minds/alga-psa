import { describe, expect, it } from 'vitest';

import { EventSchemas } from '../src/schemas/eventBusSchema';
import { workflowEventPayloadSchemas } from '../src/schemas/domain/workflowEventPayloadSchemas';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const timestamp = '2026-07-13T16:00:00.000Z';
const basePayload = { tenantId: id(1), occurredAt: timestamp };

describe('opportunity event schemas', () => {
  it('registers every opportunity event and workflow payload ref', () => {
    const registrations = [
      ['OPPORTUNITY_CREATED', 'payload.OpportunityCreated.v1'],
      ['OPPORTUNITY_STAGE_CHANGED', 'payload.OpportunityStageChanged.v1'],
      ['OPPORTUNITY_STATUS_CHANGED', 'payload.OpportunityStatusChanged.v1'],
      ['OPPORTUNITY_STALLED', 'payload.OpportunityStalled.v1'],
      ['OPPORTUNITY_ESCALATED', 'payload.OpportunityEscalated.v1'],
      ['OPPORTUNITY_NEXT_ACTION_OVERDUE', 'payload.OpportunityNextActionOverdue.v1'],
      ['OPPORTUNITY_SUGGESTION_CREATED', 'payload.OpportunitySuggestionCreated.v1'],
    ] as const;

    for (const [eventType, payloadRef] of registrations) {
      expect(EventSchemas[eventType]).toBeDefined();
      expect(workflowEventPayloadSchemas[payloadRef]).toBeDefined();
    }
  });

  it('accepts the OPPORTUNITY_CREATED payload published by the module', () => {
    const result = EventSchemas.OPPORTUNITY_CREATED.safeParse({
      id: id(2),
      eventType: 'OPPORTUNITY_CREATED',
      timestamp,
      payload: {
        ...basePayload,
        opportunityId: id(3),
        clientId: id(4),
        ownerId: id(5),
        stage: 'identified',
        createdAt: timestamp,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid opportunity stage', () => {
    const result = EventSchemas.OPPORTUNITY_CREATED.safeParse({
      id: id(2),
      eventType: 'OPPORTUNITY_CREATED',
      timestamp,
      payload: {
        ...basePayload,
        opportunityId: id(3),
        clientId: id(4),
        ownerId: id(5),
        stage: 'negotiating',
        createdAt: timestamp,
      },
    });

    expect(result.success).toBe(false);
  });
});
