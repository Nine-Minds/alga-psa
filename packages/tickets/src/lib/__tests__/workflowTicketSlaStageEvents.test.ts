import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  ticketSlaStageBreachedEventPayloadSchema,
  ticketSlaStageEnteredEventPayloadSchema,
  ticketSlaStageMetEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/ticketEventSchemas';
import {
  buildTicketResolutionSlaStageCompletionEvent,
  buildTicketResolutionSlaStageEnteredEvent,
} from '../workflowTicketSlaStageEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('workflowTicketSlaStageEvents', () => {
  it('emits resolution stage entered with deterministic targetAt', () => {
    const enteredAt = '2026-01-23T12:00:00.000Z';
    const entered = buildTicketResolutionSlaStageEnteredEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      itilPriorityLevel: 2, // HIGH -> 4 hours
      enteredAt,
    });

    expect(entered?.eventType).toBe('TICKET_SLA_STAGE_ENTERED');
    expect(entered?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: TENANT_ID,
      stage: 'resolution',
      enteredAt,
      targetAt: '2026-01-23T16:00:00.000Z',
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: enteredAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageEnteredEventPayloadSchema.parse(buildWorkflowPayload(entered!.payload as any, ctx));
  });

  it('emits resolution stage met when closed before targetAt', () => {
    const enteredAt = '2026-01-23T12:00:00.000Z';
    const closedAt = '2026-01-23T15:59:00.000Z';
    const met = buildTicketResolutionSlaStageCompletionEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      itilPriorityLevel: 2,
      enteredAt,
      closedAt,
    });

    expect(met?.eventType).toBe('TICKET_SLA_STAGE_MET');
    expect(met?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: TENANT_ID,
      stage: 'resolution',
      metAt: closedAt,
      targetAt: '2026-01-23T16:00:00.000Z',
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: closedAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageMetEventPayloadSchema.parse(buildWorkflowPayload(met!.payload as any, ctx));
  });

  it('emits resolution stage breached with overdueBySeconds when closed after targetAt', () => {
    const enteredAt = '2026-01-23T12:00:00.000Z';
    const closedAt = '2026-01-23T17:00:05.000Z';
    const breached = buildTicketResolutionSlaStageCompletionEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      itilPriorityLevel: 2,
      enteredAt,
      closedAt,
    });

    expect(breached?.eventType).toBe('TICKET_SLA_STAGE_BREACHED');
    expect(breached?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: TENANT_ID,
      stage: 'resolution',
      breachedAt: closedAt,
      targetAt: '2026-01-23T16:00:00.000Z',
      overdueBySeconds: 3605,
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: closedAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageBreachedEventPayloadSchema.parse(buildWorkflowPayload(breached!.payload as any, ctx));
  });
});

